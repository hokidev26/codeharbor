package server

import "testing"

func TestRemoteLoginLocaleFromAcceptLanguage(t *testing.T) {
	tests := []struct {
		name   string
		header string
		want   remoteLoginLocale
	}{
		{name: "simplified Chinese", header: "zh-CN,zh;q=0.9,en;q=0.8", want: remoteLoginLocaleChineseSimplified},
		{name: "traditional Chinese", header: "zh-TW,zh;q=0.9", want: remoteLoginLocaleChineseTraditional},
		{name: "traditional Chinese region variant", header: "zh-Hant-HK,en;q=0.8", want: remoteLoginLocaleChineseTraditional},
		{name: "English", header: "en-US,en;q=0.9,zh;q=0.8", want: remoteLoginLocaleEnglish},
		{name: "quality selects supported language", header: "zh-CN;q=0.3, en-US;q=0.9", want: remoteLoginLocaleEnglish},
		{name: "equal quality retains header order", header: "en;q=0.8,zh-TW;q=0.8", want: remoteLoginLocaleEnglish},
		{name: "zero quality is excluded", header: "en;q=0,zh-TW;q=0.5", want: remoteLoginLocaleChineseTraditional},
		{name: "unsupported falls back", header: "fr-CA, de;q=0.9", want: remoteLoginLocaleChineseSimplified},
		{name: "empty falls back", header: "", want: remoteLoginLocaleChineseSimplified},
		{name: "malformed quality is ignored", header: "en;q=1.1,zh-TW;q=0.4", want: remoteLoginLocaleChineseTraditional},
		{name: "malicious markup falls back", header: "en-US,<script>alert(1)</script>;q=1", want: remoteLoginLocaleChineseSimplified},
		{name: "control character falls back", header: "en-US\r\nX-Injected: true", want: remoteLoginLocaleChineseSimplified},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := remoteLoginLocaleFromAcceptLanguage(test.header); got != test.want {
				t.Fatalf("remoteLoginLocaleFromAcceptLanguage(%q) = %q, want %q", test.header, got, test.want)
			}
		})
	}
}

func TestRemoteLoginCopyForLocale(t *testing.T) {
	tests := []struct {
		locale       remoteLoginLocale
		languageTag  string
		pageTitle    string
		passwordText string
		footer       string
	}{
		{remoteLoginLocaleChineseSimplified, "zh-CN", "Autoto 远程访问保护", "访问密码", "本机 localhost 访问不受影响"},
		{remoteLoginLocaleChineseTraditional, "zh-TW", "Autoto 遠端存取保護", "存取密碼", "本機 localhost 存取不受影響"},
		{remoteLoginLocaleEnglish, "en", "Autoto Remote Access Protection", "Access password", "Local localhost access is unaffected"},
	}

	for _, test := range tests {
		t.Run(test.languageTag, func(t *testing.T) {
			copy := remoteLoginCopyForLocale(test.locale)
			if copy.LanguageTag != test.languageTag || copy.PageTitle != test.pageTitle || copy.PasswordLabel != test.passwordText || copy.Footer != test.footer {
				t.Fatalf("unexpected copy for %q: %#v", test.locale, copy)
			}
			if copy.RestrictedPolicyTitle == "" || copy.FullPolicyTitle == "" || copy.SubmitLabel == "" || copy.DisabledSubmitLabel == "" {
				t.Fatalf("copy for %q is incomplete: %#v", test.locale, copy)
			}
		})
	}
}

func TestRemoteLoginCopyForAcceptLanguageUsesSelectedLocale(t *testing.T) {
	copy := remoteLoginCopyForAcceptLanguage("fr;q=1, en-GB;q=0.8, zh-CN;q=0.7")
	if copy.LanguageTag != "en" || copy.PageTitle != "Autoto Remote Access Protection" {
		t.Fatalf("expected English copy, got %#v", copy)
	}
}
