//go:build desktop

package desktop

import "testing"

func TestParseDeepLink(t *testing.T) {
	cases := []struct {
		raw    string
		ok     bool
		host   string
		target string
	}{
		{"autoto://agent?id=abc", true, "agent", "/#agent=abc"},
		{"autoto://project/my-proj", true, "project", "/#project=my-proj"},
		{"autoto://settings?panel=remote-access", true, "settings", "/#settings=remote-access"},
		{"autoto://open?view=chat", true, "open", "/#chat"},
		{"https://evil.example", false, "", ""},
		{"autoto://shell/rm", false, "", ""},
		{"file:///etc/passwd", false, "", ""},
	}
	for _, tc := range cases {
		link, ok := ParseDeepLink(tc.raw)
		if ok != tc.ok {
			t.Fatalf("%q ok=%v want %v", tc.raw, ok, tc.ok)
		}
		if !ok {
			continue
		}
		if link.Host != tc.host || link.Target != tc.target {
			t.Fatalf("%q => host=%q target=%q want host=%q target=%q", tc.raw, link.Host, link.Target, tc.host, tc.target)
		}
	}
}

func TestFindDeepLinkInArgs(t *testing.T) {
	raw, ok := FindDeepLinkInArgs([]string{"--flag", "autoto://agent?id=1"})
	if !ok || raw != "autoto://agent?id=1" {
		t.Fatalf("got %q ok=%v", raw, ok)
	}
}
