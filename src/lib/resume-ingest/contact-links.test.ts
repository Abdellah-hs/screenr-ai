import { describe, it, expect } from "vitest";
import { harvestContactLinks, withHarvestedLinks } from "./contact-links";

const BLANK = {
  linkedin_url: null,
  github_url: null,
  portfolio_url: null,
} as const;

describe("harvestContactLinks", () => {
  it("recovers a LinkedIn URL hidden behind a markdown link's label", () => {
    const markdown = "# Alice Ng\n\n[LinkedIn](https://www.linkedin.com/in/alice-ng) · Paris";

    const links = harvestContactLinks(markdown);

    expect(links.linkedin_url).toBe("https://www.linkedin.com/in/alice-ng");
  });

  it("recovers a schemeless LinkedIn profile printed as plain text", () => {
    const links = harvestContactLinks("Contact: linkedin.com/in/alice-ng");

    expect(links.linkedin_url).toBe("https://linkedin.com/in/alice-ng");
  });

  it("ignores a bare linkedin.com with no profile path", () => {
    const links = harvestContactLinks("Sourced candidates on linkedin.com daily.");

    expect(links.linkedin_url).toBeNull();
  });

  it("trims a GitHub repo link back to the owner's profile", () => {
    const links = harvestContactLinks("Built [the parser](https://github.com/alice/parser).");

    expect(links.github_url).toBe("https://github.com/alice");
  });

  it("skips GitHub's own pages when looking for a profile", () => {
    const links = harvestContactLinks(
      "Automated releases with https://github.com/features/actions and https://github.com/alice",
    );

    expect(links.github_url).toBe("https://github.com/alice");
  });

  it("takes a portfolio from an explicit URL", () => {
    const links = harvestContactLinks("Portfolio: https://alice.dev/work");

    expect(links.portfolio_url).toBe("https://alice.dev/work");
  });

  it("does not read a skills list as a personal website", () => {
    const links = harvestContactLinks("Skills: Node.js, socket.io, Vue.js, Next.js");

    expect(links.portfolio_url).toBeNull();
  });

  it("does not treat LinkedIn or GitHub as the portfolio", () => {
    const links = harvestContactLinks(
      "https://www.linkedin.com/in/alice-ng and https://github.com/alice",
    );

    expect(links.portfolio_url).toBeNull();
  });

  it("ignores the converter's own cross-page anchors and inline images", () => {
    const links = harvestContactLinks("[see page 3](#page-3-0-0)\n\n![](_page_0_Picture_0.jpeg)");

    expect(links).toEqual(BLANK);
  });

  it("ignores the XML namespaces a converted DOCX drags along", () => {
    const links = harvestContactLinks(
      "http://schemas.openxmlformats.org/drawingml/2006/main http://www.w3.org/1999/xhtml",
    );

    expect(links.portfolio_url).toBeNull();
  });

  it("drops the sentence punctuation that follows a URL", () => {
    const links = harvestContactLinks("See https://alice.dev/work, or ask me.");

    expect(links.portfolio_url).toBe("https://alice.dev/work");
  });

  it("finds nothing in a document that contains no links", () => {
    const links = harvestContactLinks("Alice Ng\nSenior Engineer\nParis, France");

    expect(links).toEqual(BLANK);
  });

  it("does not read an employer's website out of the experience section", () => {
    const markdown = [
      "# Alice Ng",
      "Senior Engineer · Paris",
      "",
      "## Experience",
      "",
      "**Acme Corp** — Senior Engineer, 2021-2024",
      "Rebuilt the checkout at https://www.acme.com",
    ].join("\n");

    const links = harvestContactLinks(markdown);

    expect(links.portfolio_url).toBeNull();
  });

  it("takes a link labelled as a portfolio wherever it appears", () => {
    const markdown = [
      "# Alice Ng",
      "",
      "## Projects",
      "",
      "Case studies on my [Portfolio](https://alice.dev).",
    ].join("\n");

    const links = harvestContactLinks(markdown);

    expect(links.portfolio_url).toBe("https://alice.dev");
  });

  it("refuses a site whose domain is a company the candidate worked at", () => {
    const markdown = "# Alice Ng\nSenior Engineer at Acme — https://www.acme.com";

    const links = harvestContactLinks(markdown, ["Acme Corporation"]);

    expect(links.portfolio_url).toBeNull();
  });

  it("still takes the candidate's own site when employers are known", () => {
    const markdown = "# Alice Ng\nhttps://alice.dev · Paris";

    const links = harvestContactLinks(markdown, ["Acme Corporation", "Globex Ltd"]);

    expect(links.portfolio_url).toBe("https://alice.dev");
  });

  it("refuses a university's website the same way", () => {
    const markdown = "# Alice Ng\nMSc, https://www.sorbonne-universite.fr";

    const links = harvestContactLinks(markdown, [null, "Sorbonne Université"]);

    expect(links.portfolio_url).toBeNull();
  });
});

describe("withHarvestedLinks", () => {
  it("fills only the fields the model left blank", () => {
    const parsed = {
      first_name: "Alice",
      linkedin_url: "https://www.linkedin.com/in/typed-by-the-model",
      github_url: null,
      portfolio_url: "",
    };

    const filled = withHarvestedLinks(
      parsed,
      "https://www.linkedin.com/in/from-the-doc https://github.com/alice https://alice.dev",
    );

    expect(filled).toEqual({
      first_name: "Alice",
      linkedin_url: "https://www.linkedin.com/in/typed-by-the-model",
      github_url: "https://github.com/alice",
      portfolio_url: "https://alice.dev",
    });
  });

  it("leaves a field null when the document has nothing to fill it with", () => {
    const filled = withHarvestedLinks({ ...BLANK }, "Alice Ng\nSenior Engineer");

    expect(filled).toEqual(BLANK);
  });

  it("restores the scheme on a link the model reported without one", () => {
    const filled = withHarvestedLinks(
      { ...BLANK, github_url: "github.com/alice", portfolio_url: "www.alice.dev" },
      "Alice Ng",
    );

    expect(filled).toEqual({
      linkedin_url: null,
      github_url: "https://github.com/alice",
      portfolio_url: "https://www.alice.dev",
    });
  });

  it("prefers a link found in the document over a value that is not a link", () => {
    const filled = withHarvestedLinks(
      { ...BLANK, github_url: "alice" },
      "Contact me at https://github.com/alice",
    );

    expect(filled.github_url).toBe("https://github.com/alice");
  });

  it("keeps an unfollowable value when the document has no link to prefer", () => {
    const filled = withHarvestedLinks({ ...BLANK, github_url: "alice" }, "Alice Ng");

    expect(filled.github_url).toBe("alice");
  });
});
