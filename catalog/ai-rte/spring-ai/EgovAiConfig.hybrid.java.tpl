package __PKG__;

import java.util.List;
import java.util.Map;

import org.egovframe.rte.ai.core.document.EgovExtractionBudget;
import org.egovframe.rte.ai.core.document.EgovTextExtractors;
import org.egovframe.rte.ai.core.guard.EgovInjectionLexicon;
import org.egovframe.rte.ai.core.guard.EgovPromptInjectionGuard;
import org.egovframe.rte.ai.core.guard.GuardPolicy;
import org.egovframe.rte.ai.core.retrieval.lexical.EgovPgTrgmLexicalSearch;
import org.egovframe.rte.ai.springai.rag.EgovDocumentLookup;
import org.egovframe.rte.ai.springai.rag.EgovHybridDocumentRetriever;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.document.Document;
import org.springframework.ai.document.MetadataMode;
import org.springframework.ai.embedding.EmbeddingModel;
import org.springframework.ai.openai.OpenAiChatModel;
import org.springframework.ai.openai.OpenAiChatOptions;
import org.springframework.ai.openai.OpenAiEmbeddingModel;
import org.springframework.ai.openai.OpenAiEmbeddingOptions;
import org.springframework.ai.openai.api.OpenAiApi;
import org.springframework.ai.rag.retrieval.search.DocumentRetriever;
import org.springframework.ai.vectorstore.SearchRequest;
import org.springframework.ai.vectorstore.VectorStore;
import org.springframework.ai.vectorstore.pgvector.PgVectorStore;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Lazy;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

@Configuration
public class EgovAiConfig {

	@Value("${egov.ai.base-url:${EGOV_AI_BASE_URL:http://localhost:11434}}")
	private String baseUrl;

	@Value("${egov.ai.api-key:${EGOV_AI_API_KEY:none}}")
	private String apiKey;

	@Value("${egov.ai.chat-model:${EGOV_AI_CHAT_MODEL:}}")
	private String chatModel;

	@Value("${egov.ai.embedding-model:${EGOV_AI_EMBEDDING_MODEL:}}")
	private String embeddingModel;

	@Value("${egov.ai.embedding-dimensions:${EGOV_AI_EMBEDDING_DIMENSIONS:1024}}")
	private int dimensions;

	@Value("${egov.ai.guard.policy:${EGOV_AI_GUARD_POLICY:block}}")
	private String guardPolicy;

	@Value("${egov.ai.pgvector.url:${EGOV_AI_PGVECTOR_URL:jdbc:postgresql://localhost:5432/egovai}}")
	private String pgUrl;

	@Value("${egov.ai.pgvector.username:${EGOV_AI_PGVECTOR_USERNAME:}}")
	private String pgUsername;

	@Value("${egov.ai.pgvector.password:${EGOV_AI_PGVECTOR_PASSWORD:}}")
	private String pgPassword;

	@Value("${egov.ai.top-k:${EGOV_AI_TOP_K:4}}")
	private int topK;

	@Value("${egov.ai.lexical.threshold:${EGOV_AI_LEXICAL_THRESHOLD:0.3}}")
	private double lexicalThreshold;

	@Value("${egov.ai.lexical.weight:${EGOV_AI_LEXICAL_WEIGHT:1.0}}")
	private double lexicalWeight;

	@Value("${egov.ai.lexical.init:${EGOV_AI_LEXICAL_INIT:true}}")
	private boolean lexicalInit;

	@Bean
	public EgovTextExtractors egovAiTextExtractors() {
		return EgovTextExtractors.defaults(EgovExtractionBudget.defaults());
	}

	@Bean
	public EgovPromptInjectionGuard egovAiInjectionGuard() {
		return EgovPromptInjectionGuard.of(GuardPolicy.parse(guardPolicy), EgovInjectionLexicon.seed());
	}

	@Bean
	@Lazy
	public OpenAiApi egovAiOpenAiApi() {
		return OpenAiApi.builder().baseUrl(baseUrl).apiKey(apiKey).build();
	}

	@Bean
	@Lazy
	public EmbeddingModel egovAiEmbeddingModel(OpenAiApi api) {
		return new OpenAiEmbeddingModel(api, MetadataMode.EMBED, OpenAiEmbeddingOptions.builder().model(embeddingModel).build());
	}

	@Bean
	@Lazy
	public ChatClient egovAiChatClient(OpenAiApi api) {
		OpenAiChatModel model = OpenAiChatModel.builder().openAiApi(api)
				.defaultOptions(OpenAiChatOptions.builder().model(chatModel).build()).build();
		return ChatClient.builder(model).build();
	}

	@Bean
	@Lazy
	public VectorStore egovAiVectorStore(EmbeddingModel embeddingModel) {
		return PgVectorStore.builder(new JdbcTemplate(pgDataSource()), embeddingModel).dimensions(dimensions)
				.vectorTableName("egov_ai_vector").initializeSchema(true).build();
	}

	/**
	 * 하이브리드 검색기 — 밀집(벡터) 순위와 어휘(pg_trgm) 순위를 RRF 로 융합한다. 어휘 채널에만 잡힌 조각은 본문을 조회해 포함한다.
	 * 어휘 채널은 색인 때 메타데이터에 넣은 id 로 조각을 가리킨다(EgovAiRagService.ingest).
	 */
	@Bean
	@Lazy
	public DocumentRetriever egovAiRetriever(VectorStore vectorStore) {
		DriverManagerDataSource ds = pgDataSource();
		JdbcTemplate jdbc = new JdbcTemplate(ds);
		if (lexicalInit) {
			// DBA 가 직접 적용하는 환경은 EGOV_AI_LEXICAL_INIT=false 로 끄고 EGOV-AI.md 의 SQL 을 실행한다
			jdbc.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm");
			jdbc.execute("CREATE INDEX IF NOT EXISTS egov_ai_vector_trgm ON egov_ai_vector USING gin (content gin_trgm_ops)");
		}
		EgovPgTrgmLexicalSearch lexical = new EgovPgTrgmLexicalSearch(jdbc, new DataSourceTransactionManager(ds), "egov_ai_vector", "content",
				"metadata", lexicalThreshold);
		ObjectMapper mapper = new ObjectMapper();
		EgovDocumentLookup lookup = ids -> ids.isEmpty() ? List.<Document>of()
				: jdbc.query("SELECT id, content, metadata FROM egov_ai_vector WHERE id::text IN (" + "?, ".repeat(ids.size() - 1) + "?)",
						(rs, i) -> new Document(rs.getString(1), rs.getString(2), metadataOf(mapper, rs.getString(3))), ids.toArray());
		return EgovHybridDocumentRetriever.builder()
				.dense(query -> vectorStore.similaritySearch(SearchRequest.builder().query(query.text()).topK(topK).build()))
				.lexical(lexical).documentLookup(lookup).lexicalWeight(lexicalWeight).topK(topK).build();
	}

	private DriverManagerDataSource pgDataSource() {
		DriverManagerDataSource ds = new DriverManagerDataSource(pgUrl, pgUsername, pgPassword);
		ds.setDriverClassName("org.postgresql.Driver");
		return ds;
	}

	private static Map<String, Object> metadataOf(ObjectMapper mapper, String json) {
		try {
			return json == null || json.isBlank() ? Map.of() : mapper.readValue(json, new TypeReference<Map<String, Object>>() {
			});
		} catch (JsonProcessingException e) {
			throw new IllegalStateException("색인 메타데이터를 읽지 못했습니다", e);
		}
	}
}
