package __PKG__;

import org.egovframe.rte.ai.core.document.EgovExtractionBudget;
import org.egovframe.rte.ai.core.document.EgovTextExtractors;
import org.egovframe.rte.ai.core.guard.EgovInjectionLexicon;
import org.egovframe.rte.ai.core.guard.EgovPromptInjectionGuard;
import org.egovframe.rte.ai.core.guard.GuardPolicy;
import org.egovframe.rte.ai.core.retrieval.lexical.EgovPgTrgmLexicalSearch;
import org.egovframe.rte.ai.langchain4j.rag.EgovHybridContentRetriever;
import org.egovframe.rte.ai.langchain4j.rag.EgovJdbcSegmentLookup;
import org.postgresql.ds.PGSimpleDataSource;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Lazy;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;

import dev.langchain4j.data.segment.TextSegment;
import dev.langchain4j.model.chat.ChatModel;
import dev.langchain4j.model.embedding.EmbeddingModel;
import dev.langchain4j.model.openai.OpenAiChatModel;
import dev.langchain4j.model.openai.OpenAiEmbeddingModel;
import dev.langchain4j.rag.content.retriever.ContentRetriever;
import dev.langchain4j.rag.content.retriever.EmbeddingStoreContentRetriever;
import dev.langchain4j.store.embedding.EmbeddingStore;
import dev.langchain4j.store.embedding.pgvector.PgVectorEmbeddingStore;

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
	public ChatModel egovAiChatModel() {
		return OpenAiChatModel.builder().baseUrl(openAiBase()).apiKey(apiKey).modelName(chatModel).build();
	}

	@Bean
	@Lazy
	public EmbeddingModel egovAiEmbeddingModel() {
		return OpenAiEmbeddingModel.builder().baseUrl(openAiBase()).apiKey(apiKey).modelName(embeddingModel).build();
	}

	@Bean
	@Lazy
	public EmbeddingStore<TextSegment> egovAiEmbeddingStore() {
		return PgVectorEmbeddingStore.datasourceBuilder().datasource(pgDataSource()).table("egov_ai_segment").dimension(dimensions).createTable(true)
				.build();
	}

	/**
	 * 하이브리드 검색기 — 밀집(벡터) 순위와 어휘(pg_trgm) 순위를 RRF 로 융합한다. 어휘 채널에만 잡힌 세그먼트는 본문을 조회해 포함한다.
	 * 어휘 채널은 재색인 라이터가 메타데이터에 넣는 id 로 세그먼트를 가리킨다.
	 */
	@Bean
	@Lazy
	public ContentRetriever egovAiRetriever(EmbeddingStore<TextSegment> embeddingStore, EmbeddingModel embeddingModel) {
		PGSimpleDataSource ds = pgDataSource();
		JdbcTemplate jdbc = new JdbcTemplate(ds);
		if (lexicalInit) {
			// DBA 가 직접 적용하는 환경은 EGOV_AI_LEXICAL_INIT=false 로 끄고 EGOV-AI.md 의 SQL 을 실행한다
			jdbc.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm");
			jdbc.execute("CREATE INDEX IF NOT EXISTS egov_ai_segment_trgm ON egov_ai_segment USING gin (text gin_trgm_ops)");
		}
		EgovPgTrgmLexicalSearch lexical = new EgovPgTrgmLexicalSearch(jdbc, new DataSourceTransactionManager(ds), "egov_ai_segment",
				lexicalThreshold);
		return EgovHybridContentRetriever.builder()
				.dense(EmbeddingStoreContentRetriever.builder().embeddingStore(embeddingStore).embeddingModel(embeddingModel).maxResults(topK).build())
				.lexical(lexical).segmentLookup(EgovJdbcSegmentLookup.builder(jdbc).table("egov_ai_segment").build()).lexicalWeight(lexicalWeight)
				.topK(topK).build();
	}

	private PGSimpleDataSource pgDataSource() {
		PGSimpleDataSource ds = new PGSimpleDataSource();
		ds.setUrl(pgUrl);
		ds.setUser(pgUsername);
		ds.setPassword(pgPassword);
		return ds;
	}

	/** EGOV_AI_BASE_URL 은 서버 루트(예: http://localhost:11434) — OpenAI 호환 경로 /v1 을 붙인다. */
	private String openAiBase() {
		String base = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
		return base.endsWith("/v1") ? base : base + "/v1";
	}
}
