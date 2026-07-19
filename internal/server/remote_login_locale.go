package server

import (
	"strconv"
	"strings"
)

// remoteLoginLocale identifies a language supported by the remote access login
// page. It is intentionally separate from request handling so callers can
// select a locale before rendering either HTML or another representation.
type remoteLoginLocale string

const (
	remoteLoginLocaleChineseSimplified  remoteLoginLocale = "zh-CN"
	remoteLoginLocaleChineseTraditional remoteLoginLocale = "zh-TW"
	remoteLoginLocaleEnglish            remoteLoginLocale = "en"
)

const maxAcceptLanguageLength = 8192

// remoteLoginLocaleFromAcceptLanguage chooses the best supported locale from
// an Accept-Language header. Unsupported, malformed, disabled (q=0), and
// unsafe values are ignored. The stable fallback is Simplified Chinese, which
// preserves the login page's existing language when clients send no header.
func remoteLoginLocaleFromAcceptLanguage(header string) remoteLoginLocale {
	if len(header) > maxAcceptLanguageLength || !safeAcceptLanguageHeader(header) {
		return remoteLoginLocaleChineseSimplified
	}

	bestLocale := remoteLoginLocaleChineseSimplified
	bestQuality := -1.0
	bestPosition := len(header) + 1
	for position, item := range strings.Split(header, ",") {
		language, quality, ok := parseAcceptLanguageItem(item)
		if !ok || quality <= 0 {
			continue
		}
		locale, supported := remoteLoginLocaleForTag(language)
		if !supported {
			continue
		}
		if quality > bestQuality || (quality == bestQuality && position < bestPosition) {
			bestLocale = locale
			bestQuality = quality
			bestPosition = position
		}
	}
	return bestLocale
}

func safeAcceptLanguageHeader(header string) bool {
	for _, r := range header {
		// Accept-Language is ASCII by definition. Accept only the small grammar
		// subset this parser supports, so unexpected content is never partially
		// honored and cannot be propagated by a later renderer or logger.
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			continue
		}
		switch r {
		case ' ', '\t', ',', ';', '=', '.', '-', '*':
			continue
		default:
			return false
		}
	}
	return true
}

func parseAcceptLanguageItem(item string) (string, float64, bool) {
	parts := strings.Split(item, ";")
	language := strings.ToLower(strings.TrimSpace(parts[0]))
	if !validAcceptLanguageTag(language) {
		return "", 0, false
	}

	quality := 1.0
	for _, parameter := range parts[1:] {
		name, value, found := strings.Cut(strings.TrimSpace(parameter), "=")
		if !found || !strings.EqualFold(strings.TrimSpace(name), "q") {
			continue
		}
		parsed, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
		if err != nil || parsed < 0 || parsed > 1 {
			return "", 0, false
		}
		quality = parsed
	}
	return language, quality, true
}

func validAcceptLanguageTag(tag string) bool {
	if tag == "*" {
		return true
	}
	if tag == "" || len(tag) > 63 {
		return false
	}
	for i, part := range strings.Split(tag, "-") {
		if part == "" || (i == 0 && len(part) < 2) || len(part) > 8 {
			return false
		}
		for _, r := range part {
			if (r < 'a' || r > 'z') && (r < '0' || r > '9') {
				return false
			}
		}
	}
	return true
}

func remoteLoginLocaleForTag(tag string) (remoteLoginLocale, bool) {
	parts := strings.Split(tag, "-")
	switch parts[0] {
	case "en":
		return remoteLoginLocaleEnglish, true
	case "zh":
		if len(parts) > 1 {
			switch parts[1] {
			case "tw", "hk", "mo", "hant":
				return remoteLoginLocaleChineseTraditional, true
			}
		}
		return remoteLoginLocaleChineseSimplified, true
	default:
		return "", false
	}
}

// remoteLoginCopy contains all remote-login page text that varies by locale.
// Values are plain text, never HTML; renderers must escape dynamic content.
type remoteLoginCopy struct {
	LanguageTag                      string
	PageTitle                        string
	ConnectionState                  string
	Heading                          string
	PasswordPlaceholder              string
	PasswordLabel                    string
	SubmitLabel                      string
	DisabledSubmitLabel              string
	UnconfiguredPasswordNoticeBefore string
	UnconfiguredPasswordNoticeAfter  string
	RestrictedPolicyTitle            string
	RestrictedPolicyDescription      string
	FullPolicyTitle                  string
	FullPolicyDescription            string
	Footer                           string
	HTTPSRequiredMessage             string
	CrossSiteDeniedMessage           string
	FormUnreadableMessage            string
	IncorrectPasswordMessage         string
	SessionFailedMessage             string
	LockRetrySoonMessage             string
	LockRetryMinutesMessage          string
}

func remoteLoginCopyForAcceptLanguage(header string) remoteLoginCopy {
	return remoteLoginCopyForLocale(remoteLoginLocaleFromAcceptLanguage(header))
}

func remoteLoginCopyForLocale(locale remoteLoginLocale) remoteLoginCopy {
	switch locale {
	case remoteLoginLocaleChineseTraditional:
		return remoteLoginCopy{
			LanguageTag: "zh-TW", PageTitle: "Autoto 遠端存取保護", ConnectionState: "等待驗證", Heading: "安全解鎖 Autoto",
			PasswordPlaceholder: "請輸入存取密碼", PasswordLabel: "存取密碼", SubmitLabel: "解鎖 Autoto", DisabledSubmitLabel: "等待設定存取密碼",
			UnconfiguredPasswordNoticeBefore: "遠端存取已觸發保護，但尚未設定 ", UnconfiguredPasswordNoticeAfter: "。請先停止裸露隧道，設定密碼或使用 Cloudflare Access 後再重試。",
			RestrictedPolicyTitle: "執行主機已設為受限權限", RestrictedPolicyDescription: "登入後僅可存取專案目錄，最高 acceptEdits；如需變更，請在執行 Autoto 的主機透過 localhost 開啟設定。",
			FullPolicyTitle: "執行主機已設為完整權限", FullPolicyDescription: "登入後可存取主機目錄、終端與 bypassPermissions；此模式只能在執行 Autoto 的主機本機變更。",
			Footer:               "本機 localhost 存取不受影響",
			HTTPSRequiredMessage: "遠端存取必須使用 HTTPS；請透過 HTTPS 網址重新開啟此頁面。", CrossSiteDeniedMessage: "跨網站登入請求已遭拒絕。",
			FormUnreadableMessage: "無法讀取密碼表單。", IncorrectPasswordMessage: "密碼不正確，請重試。", SessionFailedMessage: "無法建立安全工作階段，請稍後重試。",
			LockRetrySoonMessage: "密碼錯誤次數過多，請稍後重試。", LockRetryMinutesMessage: "密碼錯誤次數過多，請約 %d 分鐘後重試。",
		}
	case remoteLoginLocaleEnglish:
		return remoteLoginCopy{
			LanguageTag: "en", PageTitle: "Autoto Remote Access Protection", ConnectionState: "Awaiting verification", Heading: "Securely unlock Autoto",
			PasswordPlaceholder: "Enter access password", PasswordLabel: "Access password", SubmitLabel: "Unlock Autoto", DisabledSubmitLabel: "Waiting for access password setup",
			UnconfiguredPasswordNoticeBefore: "Remote access protection is active, but ", UnconfiguredPasswordNoticeAfter: " is not configured. Stop the exposed tunnel first, then set a password or use Cloudflare Access before retrying.",
			RestrictedPolicyTitle: "This host uses restricted access", RestrictedPolicyDescription: "After signing in, you can access only the project directory, up to acceptEdits. To change this, open settings through localhost on the host running Autoto.",
			FullPolicyTitle: "This host uses full access", FullPolicyDescription: "After signing in, you can access host directories, the terminal, and bypassPermissions. This mode can be changed only locally on the host running Autoto.",
			Footer:               "Local localhost access is unaffected",
			HTTPSRequiredMessage: "Remote access requires HTTPS. Reopen this page using an HTTPS address.", CrossSiteDeniedMessage: "The cross-site sign-in request was denied.",
			FormUnreadableMessage: "The password form could not be read.", IncorrectPasswordMessage: "The password is incorrect. Try again.", SessionFailedMessage: "A secure session could not be created. Try again later.",
			LockRetrySoonMessage: "Too many incorrect password attempts. Try again later.", LockRetryMinutesMessage: "Too many incorrect password attempts. Try again in about %d minutes.",
		}
	default:
		return remoteLoginCopy{
			LanguageTag: "zh-CN", PageTitle: "Autoto 远程访问保护", ConnectionState: "等待验证", Heading: "安全解锁 Autoto",
			PasswordPlaceholder: "请输入访问密码", PasswordLabel: "访问密码", SubmitLabel: "解锁 Autoto", DisabledSubmitLabel: "等待配置访问密码",
			UnconfiguredPasswordNoticeBefore: "远程访问已触发保护，但还没有配置 ", UnconfiguredPasswordNoticeAfter: "。请先停止裸露隧道，设置密码或使用 Cloudflare Access 后再重试。",
			RestrictedPolicyTitle: "运行主机已设为受限权限", RestrictedPolicyDescription: "登录后仅可访问项目目录，最高 acceptEdits；如需更改，请在运行 Autoto 的主机通过 localhost 打开设置。",
			FullPolicyTitle: "运行主机已设为完整权限", FullPolicyDescription: "登录后可访问主机目录、终端与 bypassPermissions；此模式只能在运行 Autoto 的主机本地更改。",
			Footer:               "本机 localhost 访问不受影响",
			HTTPSRequiredMessage: "远程访问必须使用 HTTPS；请通过 HTTPS 地址重新打开此页面。", CrossSiteDeniedMessage: "跨站登录请求已被拒绝。",
			FormUnreadableMessage: "无法读取密码表单。", IncorrectPasswordMessage: "密码不正确，请重试。", SessionFailedMessage: "无法建立安全会话，请稍后重试。",
			LockRetrySoonMessage: "密码错误次数过多，请稍后重试。", LockRetryMinutesMessage: "密码错误次数过多，请约 %d 分钟后重试。",
		}
	}
}
