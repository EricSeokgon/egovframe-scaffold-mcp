package __PKG__;

import org.egovframe.rte.ai.core.document.EgovExtractionBudget;
import org.egovframe.rte.ai.core.document.EgovTextExtractors;
import org.egovframe.rte.ai.core.guard.EgovInjectionLexicon;
import org.egovframe.rte.ai.core.guard.EgovPromptInjectionGuard;
import org.egovframe.rte.ai.core.guard.GuardPolicy;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.document.MetadataMode;
import org.springframework.ai.embedding.EmbeddingModel;
import org.springframework.ai.openai.OpenAiChatModel;
import org.springframework.ai.openai.OpenAiChatOptions;
import org.springframework.ai.openai.OpenAiEmbeddingModel;
import org.springframework.ai.openai.OpenAiEmbeddingOptions;
import org.springframework.ai.openai.api.OpenAiApi;
import org.springframework.ai.vectorstore.VectorStore;
import org.springframework.ai.vectorstore.pgvector.PgVectorStore;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Lazy;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

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
		DriverManagerDataSource ds = new DriverManagerDataSource(pgUrl, pgUsername, pgPassword);
		ds.setDriverClassName("org.postgresql.Driver");
		return PgVectorStore.builder(new JdbcTemplate(ds), embeddingModel).dimensions(dimensions)
				.vectorTableName("egov_ai_vector").initializeSchema(true).build();
	}
}
