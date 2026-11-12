package __PKG__;

import org.egovframe.rte.ai.core.document.EgovExtractionBudget;
import org.egovframe.rte.ai.core.document.EgovTextExtractors;
import org.egovframe.rte.ai.core.guard.EgovInjectionLexicon;
import org.egovframe.rte.ai.core.guard.EgovPromptInjectionGuard;
import org.egovframe.rte.ai.core.guard.GuardPolicy;
import org.postgresql.ds.PGSimpleDataSource;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Lazy;

import dev.langchain4j.data.segment.TextSegment;
import dev.langchain4j.model.chat.ChatModel;
import dev.langchain4j.model.embedding.EmbeddingModel;
import dev.langchain4j.model.openai.OpenAiChatModel;
import dev.langchain4j.model.openai.OpenAiEmbeddingModel;
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
		PGSimpleDataSource ds = new PGSimpleDataSource();
		ds.setUrl(pgUrl);
		ds.setUser(pgUsername);
		ds.setPassword(pgPassword);
		return PgVectorEmbeddingStore.datasourceBuilder().datasource(ds).table("egov_ai_segment").dimension(dimensions).createTable(true).build();
	}

	/** EGOV_AI_BASE_URL 은 서버 루트(예: http://localhost:11434) — OpenAI 호환 경로 /v1 을 붙인다. */
	private String openAiBase() {
		String base = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
		return base.endsWith("/v1") ? base : base + "/v1";
	}
}
