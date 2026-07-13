package server

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"errors"
	"fmt"
	"html"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"path/filepath"
	"regexp"
	"strings"
	"unicode/utf8"

	"autoto/internal/db"
)

const (
	maxAttachmentBytes     int64 = 10 << 20
	maxMessageUploadBytes  int64 = 25 << 20
	maxAttachmentTextRunes       = 200000
	multipartMemoryBytes   int64 = 8 << 20
)

type attachmentUploadError struct {
	Status  int
	Message string
}

func (e attachmentUploadError) Error() string { return e.Message }

func parseMultipartAttachments(w http.ResponseWriter, r *http.Request) (string, string, []db.Attachment, error) {
	r.Body = http.MaxBytesReader(w, r.Body, maxMessageUploadBytes)
	if err := r.ParseMultipartForm(multipartMemoryBytes); err != nil {
		return "", "", nil, attachmentUploadError{Status: http.StatusBadRequest, Message: fmt.Sprintf("附件上传解析失败：%v", err)}
	}
	text := strings.TrimSpace(r.FormValue("text"))
	createdBy := strings.TrimSpace(r.FormValue("createdBy"))
	files := multipartFiles(r.MultipartForm)
	if text == "" && len(files) == 0 {
		return "", "", nil, attachmentUploadError{Status: http.StatusBadRequest, Message: "text or files is required"}
	}
	attachments := make([]db.Attachment, 0, len(files))
	var total int64
	for _, header := range files {
		if header == nil {
			continue
		}
		if header.Size > maxAttachmentBytes {
			return "", "", nil, attachmentUploadError{Status: http.StatusRequestEntityTooLarge, Message: fmt.Sprintf("%s 超过 10 MB 限制", sanitizeAttachmentFilename(header.Filename))}
		}
		total += header.Size
		if total > maxMessageUploadBytes {
			return "", "", nil, attachmentUploadError{Status: http.StatusRequestEntityTooLarge, Message: "单条消息附件总大小超过 25 MB"}
		}
		attachment, err := buildAttachmentFromPart(header)
		if err != nil {
			return "", "", nil, err
		}
		attachments = append(attachments, attachment)
	}
	return text, createdBy, attachments, nil
}

func multipartFiles(form *multipart.Form) []*multipart.FileHeader {
	if form == nil || form.File == nil {
		return nil
	}
	out := make([]*multipart.FileHeader, 0)
	out = append(out, form.File["files"]...)
	out = append(out, form.File["files[]"]...)
	return out
}

func buildAttachmentFromPart(header *multipart.FileHeader) (db.Attachment, error) {
	file, err := header.Open()
	if err != nil {
		return db.Attachment{}, attachmentUploadError{Status: http.StatusBadRequest, Message: fmt.Sprintf("无法打开附件 %s", sanitizeAttachmentFilename(header.Filename))}
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxAttachmentBytes+1))
	if err != nil {
		return db.Attachment{}, attachmentUploadError{Status: http.StatusBadRequest, Message: fmt.Sprintf("无法读取附件 %s", sanitizeAttachmentFilename(header.Filename))}
	}
	if int64(len(data)) > maxAttachmentBytes {
		return db.Attachment{}, attachmentUploadError{Status: http.StatusRequestEntityTooLarge, Message: fmt.Sprintf("%s 超过 10 MB 限制", sanitizeAttachmentFilename(header.Filename))}
	}
	filename := sanitizeAttachmentFilename(header.Filename)
	mimeType := normalizeAttachmentMIME(filename, header.Header.Get("Content-Type"), data)
	kind := classifyAttachment(filename, mimeType)
	extractedText := extractAttachmentText(kind, filename, data)
	return db.Attachment{
		Filename:      filename,
		MIMEType:      mimeType,
		Kind:          kind,
		SizeBytes:     int64(len(data)),
		Data:          data,
		ExtractedText: extractedText,
	}, nil
}

func sanitizeAttachmentFilename(name string) string {
	name = strings.TrimSpace(filepath.Base(strings.ReplaceAll(name, "\\", "/")))
	if name == "." || name == "/" || name == "" {
		return "attachment"
	}
	return strings.Map(func(r rune) rune {
		if r == 0 || r == '/' || r == '\\' || r == ':' {
			return '-'
		}
		return r
	}, name)
}

func normalizeAttachmentMIME(filename, provided string, data []byte) string {
	provided = strings.TrimSpace(strings.Split(provided, ";")[0])
	if provided != "" && provided != "application/octet-stream" {
		return provided
	}
	if extType := mime.TypeByExtension(strings.ToLower(filepath.Ext(filename))); extType != "" {
		return strings.Split(extType, ";")[0]
	}
	if len(data) > 0 {
		return http.DetectContentType(data)
	}
	return "application/octet-stream"
}

func classifyAttachment(filename, mimeType string) string {
	ext := strings.ToLower(filepath.Ext(filename))
	mimeType = strings.ToLower(mimeType)
	if strings.HasPrefix(mimeType, "image/") {
		switch mimeType {
		case "image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif":
			return "image"
		}
	}
	if mimeType == "application/pdf" || ext == ".pdf" {
		return "pdf"
	}
	if ext == ".docx" || strings.Contains(mimeType, "wordprocessingml.document") {
		return "docx"
	}
	if strings.HasPrefix(mimeType, "text/") || knownTextExtension(ext) {
		return "text"
	}
	return "binary"
}

func knownTextExtension(ext string) bool {
	switch ext {
	case ".txt", ".md", ".markdown", ".json", ".jsonl", ".csv", ".tsv", ".log", ".xml", ".yaml", ".yml", ".toml", ".ini", ".env", ".go", ".js", ".jsx", ".ts", ".tsx", ".css", ".html", ".htm", ".py", ".rb", ".rs", ".java", ".c", ".h", ".cpp", ".hpp", ".cs", ".php", ".sh", ".zsh", ".bash", ".sql", ".swift", ".kt", ".kts", ".dart", ".vue", ".svelte":
		return true
	default:
		return false
	}
}

func extractAttachmentText(kind, filename string, data []byte) string {
	switch kind {
	case "text":
		return truncateAttachmentText(decodeTextBytes(data))
	case "docx":
		text, err := extractDOCXText(data)
		if err != nil {
			return ""
		}
		return truncateAttachmentText(text)
	case "pdf":
		return truncateAttachmentText(extractPDFTextBestEffort(data))
	default:
		return ""
	}
}

func decodeTextBytes(data []byte) string {
	if utf8.Valid(data) {
		return string(data)
	}
	return strings.ToValidUTF8(string(data), "�")
}

func truncateAttachmentText(text string) string {
	text = strings.TrimSpace(text)
	if text == "" {
		return ""
	}
	runes := []rune(text)
	if len(runes) <= maxAttachmentTextRunes {
		return text
	}
	return string(runes[:maxAttachmentTextRunes]) + "\n\n[内容过长，已截断。]"
}

func extractDOCXText(data []byte) (string, error) {
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return "", err
	}
	var document *zip.File
	for _, file := range reader.File {
		if file.Name == "word/document.xml" {
			document = file
			break
		}
	}
	if document == nil {
		return "", errors.New("word/document.xml not found")
	}
	file, err := document.Open()
	if err != nil {
		return "", err
	}
	defer file.Close()
	decoder := xml.NewDecoder(file)
	var builder strings.Builder
	inText := false
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return "", err
		}
		switch t := token.(type) {
		case xml.StartElement:
			switch t.Name.Local {
			case "t":
				inText = true
			case "tab":
				builder.WriteString("\t")
			case "br", "cr", "p":
				if builder.Len() > 0 && !strings.HasSuffix(builder.String(), "\n") {
					builder.WriteString("\n")
				}
			}
		case xml.EndElement:
			if t.Name.Local == "t" {
				inText = false
			}
		case xml.CharData:
			if inText {
				builder.Write([]byte(t))
			}
		}
	}
	return strings.TrimSpace(builder.String()), nil
}

var pdfLiteralPattern = regexp.MustCompile(`\((?:\\.|[^\\)]){2,}\)`)

func extractPDFTextBestEffort(data []byte) string {
	// 标准库无法可靠解析 PDF，尤其是压缩流或扫描件。这里仅尝试提取未压缩文字字面量；
	// 如果提取不到，后续会在 prompt 中明确提示该 PDF 需要支持文档/视觉/OCR 的模型。
	matches := pdfLiteralPattern.FindAll(data, 6000)
	if len(matches) == 0 {
		return ""
	}
	parts := make([]string, 0, len(matches))
	for _, match := range matches {
		decoded := decodePDFLiteral(match)
		decoded = strings.TrimSpace(html.UnescapeString(decoded))
		if decoded == "" || len([]rune(decoded)) < 2 {
			continue
		}
		parts = append(parts, decoded)
	}
	return strings.Join(parts, " ")
}

func decodePDFLiteral(raw []byte) string {
	if len(raw) >= 2 && raw[0] == '(' && raw[len(raw)-1] == ')' {
		raw = raw[1 : len(raw)-1]
	}
	var builder strings.Builder
	for i := 0; i < len(raw); i++ {
		ch := raw[i]
		if ch != '\\' || i+1 >= len(raw) {
			builder.WriteByte(ch)
			continue
		}
		i++
		switch raw[i] {
		case 'n':
			builder.WriteByte('\n')
		case 'r':
			builder.WriteByte('\r')
		case 't':
			builder.WriteByte('\t')
		case 'b':
			builder.WriteByte('\b')
		case 'f':
			builder.WriteByte('\f')
		case '(', ')', '\\':
			builder.WriteByte(raw[i])
		default:
			builder.WriteByte(raw[i])
		}
	}
	return strings.ToValidUTF8(builder.String(), "�")
}
