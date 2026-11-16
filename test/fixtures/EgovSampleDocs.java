import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.List;

import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.apache.pdfbox.pdmodel.font.Standard14Fonts;

import kr.dogfoot.hwplib.object.HWPFile;
import kr.dogfoot.hwplib.writer.HWPWriter;
import kr.dogfoot.hwpxlib.object.HWPXFile;
import kr.dogfoot.hwpxlib.writer.HWPXWriter;

/** 테스트 표본 생성: args = 출력 디렉터리, 본문 파일(UTF-8, 줄마다 HWP·HWPX·PDF(ASCII) 본문), 한도 초과 PDF 쪽수. 본문을 명령행으로 받으면 로캘에 따라 한글이 깨진다 */
public class EgovSampleDocs {
	public static void main(String[] args) throws Exception {
		File dir = new File(args[0]);
		List<String> text = Files.readAllLines(new File(args[1]).toPath(), StandardCharsets.UTF_8);
		HWPFile hwp = kr.dogfoot.hwplib.tool.blankfilemaker.BlankFileMaker.make();
		hwp.getBodyText().getSectionList().get(0).getParagraph(0).getText().addString(text.get(0));
		HWPWriter.toFile(hwp, new File(dir, "sample.hwp").getPath());
		HWPXFile hwpx = kr.dogfoot.hwpxlib.tool.blankfilemaker.BlankFileMaker.make();
		hwpx.sectionXMLFileList().get(0).getPara(0).addNewRun().addNewT().addText(text.get(1));
		HWPXWriter.toFilepath(hwpx, new File(dir, "sample.hwpx").getPath());
		try (PDDocument pdf = new PDDocument()) {
			PDPage page = new PDPage();
			pdf.addPage(page);
			try (PDPageContentStream cs = new PDPageContentStream(pdf, page)) {
				cs.beginText();
				cs.setFont(new PDType1Font(Standard14Fonts.FontName.HELVETICA), 12);
				cs.newLineAtOffset(72, 700);
				cs.showText(text.get(2));
				cs.endText();
			}
			pdf.save(new File(dir, "sample.pdf"));
		}
		try (PDDocument big = new PDDocument()) {
			for (int i = 0; i < Integer.parseInt(args[2]); i++) {
				big.addPage(new PDPage());
			}
			big.save(new File(dir, "too-many-pages.pdf"));
		}
	}
}
