package __PKG__;

import java.io.InputStream;
import java.util.Map;
import java.util.concurrent.Callable;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/ai")
public class EgovAiController {

	private static final Logger LOG = LoggerFactory.getLogger(EgovAiController.class);

	private final EgovAiRagService service;

	public EgovAiController(EgovAiRagService service) {
		this.service = service;
	}

	@PostMapping("/documents")
	public ResponseEntity<Map<String, Object>> upload(@RequestParam("file") MultipartFile file) {
		return respond(() -> {
			String name = file.getOriginalFilename();
			if (name == null || name.isBlank() || name.lastIndexOf('.') <= 0) {
				throw new IllegalArgumentException("파일 이름(확장자 포함)이 필요합니다");
			}
			try (InputStream in = file.getInputStream()) {
				return service.ingest(name, in);
			}
		});
	}

	@PostMapping("/ask")
	public ResponseEntity<Map<String, Object>> ask(@RequestBody Map<String, String> body) {
		return respond(() -> {
			String question = body.get("question");
			if (question == null || question.isBlank() || question.length() > 2000) {
				throw new IllegalArgumentException("question 은 1~2000자여야 합니다");
			}
			return service.ask(question);
		});
	}

	/** 프로젝트의 예외 처리 설정과 무관하게 JSON 으로 답한다 — 내부 오류의 상세는 로그에만 남긴다. */
	private ResponseEntity<Map<String, Object>> respond(Callable<Map<String, Object>> work) {
		try {
			return ResponseEntity.ok(work.call());
		} catch (IllegalArgumentException e) {
			return ResponseEntity.badRequest().body(Map.of("error", String.valueOf(e.getMessage())));
		} catch (Exception e) {
			LOG.error("AI 요청 처리 실패", e);
			return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of("error", "AI 요청을 처리하지 못했습니다. 서버 로그를 확인하세요."));
		}
	}
}
