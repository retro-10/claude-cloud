import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown, parseBlocks } from "@/components/hq/Markdown";

describe("doc Markdown", () => {
  it("parses headings, lists, checklists, quotes, code and paragraphs", () => {
    const b = parseBlocks("# Title\n\nSome text\non two lines\n\n- a\n- [x] b\n\n1. one\n2. two\n\n> quoted\n\n```\ncode <b>\n```\n---");
    expect(b.map((x) => x.kind)).toEqual(["h", "p", "ul", "ol", "quote", "code", "hr"]);
    expect(b[1]).toEqual({ kind: "p", text: "Some text on two lines" });
    expect(b[2]).toEqual({ kind: "ul", items: [{ text: "a" }, { text: "b", check: true }] });
  });

  it("never renders raw HTML or unsafe links", () => {
    const html = renderToStaticMarkup(<Markdown source={"<script>alert(1)</script> [x](javascript:alert(1)) [ok](https://orladent.com) [in](/docs) [proto](//evil.com)"} />);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("//evil.com");
    expect(html).toContain('href="https://orladent.com"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('href="/docs"');
  });

  it("formats bold, italic and inline code", () => {
    const html = renderToStaticMarkup(<Markdown source={"**bold** and *it* and `x`"} />);
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>it</em>");
    expect(html).toMatch(/<code[^>]*>x<\/code>/);
  });
});
