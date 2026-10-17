import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isSecret, markField, refusalIn, restore, snapshot } from "../form-keep";

// Only the browser properties used by form-keep: no DOM implementation or package.
class FakeField {
  private currentValue = "";
  defaultValue = "";
  checked = false;
  defaultChecked = false;
  options: { selected: boolean; defaultSelected: boolean }[] = [];
  attributes: Record<string, string> = {};
  textContent = "";
  className = "";
  dispatchEvent = vi.fn<(event: Event) => boolean>(() => true);
  focus = vi.fn();
  remove = vi.fn();
  insertAdjacentElement = vi.fn();
  closest = vi.fn(() => null as FakeField | null);
  constructor(public name = "", public type = "text", value = "") { this.value = value; this.defaultValue = value; }
  get value() { return this.currentValue; }
  set value(value: string) { this.currentValue = value; }
  setAttribute(name: string, value: string) { this.attributes[name] = value; }
  removeAttribute(name: string) { delete this.attributes[name]; }
}
class FakeInput extends FakeField {}
class FakeTextarea extends FakeField {
  get value() { return super.value; }
  set value(value: string) { super.value = value; }
}
class FakeSelect extends FakeField {
  get value() { return super.value; }
  set value(value: string) { super.value = value; }
}
// setValue reads the native input prototype setter directly.
Object.defineProperty(FakeInput.prototype, "value", Object.getOwnPropertyDescriptor(FakeField.prototype, "value")!);

function form(elements: unknown[], notes: FakeField[] = []) {
  return {
    elements,
    querySelectorAll: (selector: string) => selector === "[data-field-error]" ? notes : elements.filter((el): el is FakeField => el instanceof FakeField && el.attributes["aria-invalid"] === "true"),
  } as unknown as HTMLFormElement;
}

beforeEach(() => {
  vi.stubGlobal("HTMLInputElement", FakeInput);
  vi.stubGlobal("HTMLTextAreaElement", FakeTextarea);
  vi.stubGlobal("HTMLSelectElement", FakeSelect);
  vi.stubGlobal("document", { createElement: vi.fn(() => new FakeField()) });
});
afterEach(() => vi.unstubAllGlobals());

describe("isSecret", () => {
  it("recognizes password inputs regardless of name", () => expect(isSecret({ name: "ordinary", type: "password" })).toBe(true));
  it.each(["token", "secret", "password", "apikey", "api_key", "webhook"])("recognizes embedded %s in either case", (part) => {
    for (const name of [`prefix_${part}_suffix`, `PREFIX_${part.toUpperCase()}_SUFFIX`]) expect(isSecret({ name, type: "text" })).toBe(true);
  });
  it.each(["name", "email", "notes", "title"])("allows ordinary %s", (name) => expect(isSecret({ name, type: "text" })).toBe(false));
});

describe("snapshot", () => {
  it("skips excluded input types, unnamed fields and non-fields", () => {
    const excluded = ["hidden", "file", "submit", "button", "reset", "image"].map((type) => new FakeInput(type, type, "ignored"));
    expect(snapshot(form([...excluded, new FakeInput("", "text", "ignored"), {}]))).toEqual([]);
  });
  it("keeps text, textarea, select and checked and unchecked controls", () => {
    const fields = [new FakeInput("title", "text", "Draft"), new FakeTextarea("notes", "textarea", "Notes"), new FakeSelect("choice", "select-one", "blue"), new FakeInput("flag", "checkbox", "yes"), new FakeInput("route", "radio", "north"), new FakeInput("route", "radio", "south")];
    fields[3].checked = true;
    fields[4].checked = true;
    expect(snapshot(form(fields))).toEqual([
      { name: "title", type: "text", value: "Draft", checked: false },
      { name: "notes", type: "textarea", value: "Notes", checked: false },
      { name: "choice", type: "select-one", value: "blue", checked: false },
      { name: "flag", type: "checkbox", value: "yes", checked: true },
      { name: "route", type: "radio", value: "north", checked: true },
      { name: "route", type: "radio", value: "south", checked: false },
    ]);
  });
  it("excludes every credential category when making a browser draft", () => {
    const fields = [new FakeInput("ordinary", "password", "fixture"), ...["token", "secret", "password", "apikey", "api_key", "webhook"].map((name) => new FakeInput(name.toUpperCase(), "text", "fixture")), new FakeInput("title", "text", "Draft")];
    expect(snapshot(form(fields), { secrets: false })).toEqual([{ name: "title", type: "text", value: "Draft", checked: false }]);
  });
  it("can explicitly include credentials in an in-memory refusal snapshot", () => {
    expect(snapshot(form([new FakeInput("credential", "password", "fixture")]), { secrets: true })).toEqual([{ name: "credential", type: "password", value: "fixture", checked: false }]);
  });
  it("includes credential fields by default for an in-memory refusal snapshot", () => {
    const fields = [new FakeInput("ordinary", "password", "fixture"), ...["token", "secret", "password", "apikey", "api_key", "webhook"].map((name) => new FakeInput(name, "text", "fixture"))];
    expect(snapshot(form(fields))).toEqual(fields.map((field) => ({ name: field.name, type: field.type, value: "fixture", checked: false })));
  });
  it("explicitly excludes credentials in every draft-keeper snapshot call", () => {
    const path = join(__dirname, "../../components/draft-keeper.tsx");
    const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const calls: ts.CallExpression[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "snapshot") calls.push(node);
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      const options = call.arguments[1];
      expect(options && ts.isObjectLiteralExpression(options), call.getText(source)).toBe(true);
      if (!options || !ts.isObjectLiteralExpression(options)) continue;
      expect(options.properties.some(ts.isSpreadAssignment), call.getText(source)).toBe(false);
      const secrets = options.properties.filter((property) => property.name?.getText(source) === "secrets");
      expect(secrets.length, call.getText(source)).toBeGreaterThan(0);
      for (const property of secrets) {
        expect(ts.isPropertyAssignment(property) && property.initializer.kind === ts.SyntaxKind.FalseKeyword, call.getText(source)).toBe(true);
      }
    }
  });
});

describe("restore", () => {
  it("restores untouched values and checked states, counts changes and emits events", () => {
    const fields = [new FakeInput("title"), new FakeTextarea("notes", "textarea"), new FakeSelect("choice", "select-one"), new FakeInput("flag", "checkbox", "yes"), new FakeInput("route", "radio", "north"), new FakeInput("route", "radio", "south")];
    const saved = snapshot(form(fields));
    saved[0].value = "Draft";
    saved[1].value = "Notes";
    saved[2].value = "blue";
    saved[3].checked = true;
    saved[4].checked = true;
    expect(restore(form(fields), saved)).toBe(5);
    expect(fields.map((f) => f.value)).toEqual(["Draft", "Notes", "blue", "yes", "north", "south"]);
    expect(fields.map((f) => f.checked)).toEqual([false, false, false, true, true, false]);
    for (const field of fields.slice(0, 3)) expect(field.dispatchEvent.mock.calls.map(([event]) => [event.type, event.bubbles])).toEqual([["input", true], ["change", true]]);
    expect(fields[3].dispatchEvent.mock.calls.map(([event]) => event.type)).toEqual(["change"]);
    expect(restore(form(fields), saved)).toBe(0);
  });
  it("ignores missing names, incompatible types and unchanged values", () => {
    const field = new FakeInput("title", "text", "Same");
    expect(restore(form([field]), [{ name: "missing", type: "text", value: "Old", checked: false }, { name: "title", type: "textarea", value: "Old", checked: false }, { name: "title", type: "text", value: "Same", checked: false }])).toBe(0);
    expect(field.value).toBe("Same");
    expect(field.dispatchEvent).not.toHaveBeenCalled();
  });
  it("never overwrites fresh typing, changed selections or a changed radio group", () => {
    const fields = [new FakeInput("title"), new FakeTextarea("notes", "textarea"), new FakeSelect("choice", "select-one"), new FakeInput("flag", "checkbox", "yes"), new FakeInput("route", "radio", "north"), new FakeInput("route", "radio", "south")];
    const saved = snapshot(form(fields));
    saved.forEach((s) => { if (s.type === "radio" || s.type === "checkbox") s.checked = true; else s.value = "Old"; });
    fields[0].value = "Fresh";
    fields[1].value = "Fresh notes";
    fields[2].options = [{ selected: true, defaultSelected: false }];
    fields[3].checked = true;
    fields[5].checked = true;
    expect(restore(form(fields), saved)).toBe(0);
    expect(fields[0].value).toBe("Fresh");
    expect(fields[1].value).toBe("Fresh notes");
    expect(fields[4].checked).toBe(false);
    expect(fields[5].checked).toBe(true);
  });
});

describe("markField", () => {
  it("clears previous marks, announces the message beside the named field and focuses it", () => {
    const field = new FakeInput("title");
    const old = new FakeInput("notes");
    old.setAttribute("aria-invalid", "true");
    const note = new FakeField();
    markField(form([old, field], [note]), "title", "Please revise");
    expect(note.remove).toHaveBeenCalledOnce();
    expect(old.attributes).not.toHaveProperty("aria-invalid");
    expect(field.attributes["aria-invalid"]).toBe("true");
    const [position, message] = field.insertAdjacentElement.mock.calls[0];
    expect(position).toBe("afterend");
    expect(message.textContent).toBe("Please revise");
    expect(message.attributes).toMatchObject({ role: "alert", "data-field-error": "", "data-testid": "field-error" });
    expect(field.focus).toHaveBeenCalledWith({ preventScroll: false });
  });
  it("puts checkbox errors after their fieldset", () => {
    const field = new FakeInput("flag", "checkbox");
    const fieldset = new FakeField();
    field.closest.mockReturnValue(fieldset);
    markField(form([field]), "flag", "Choose again");
    expect(fieldset.insertAdjacentElement).toHaveBeenCalledOnce();
    expect(field.insertAdjacentElement).not.toHaveBeenCalled();
  });
  it.each([null, "unknown"])("safely falls back for %s", (name) => {
    const checkbox = new FakeInput("flag", "checkbox");
    const field = new FakeInput("title");
    expect(() => markField(form([checkbox, field]), name, "Refused")).not.toThrow();
    expect(field.focus).toHaveBeenCalledOnce();
    expect(field.insertAdjacentElement).toHaveBeenCalledTimes(name ? 1 : 0);
    expect(() => markField(form([]), name, "Refused")).not.toThrow();
  });
});

describe("refusalIn", () => {
  it("decodes a refusal message and its field", () => {
    expect(refusalIn("?weekError=Try+again%21&field=title")).toEqual({ message: "Try again!", field: "title" });
  });
  it("uses the first nonempty case-insensitive error suffix", () => {
    expect(refusalIn("error=&saveERROR=First&otherError=Second")).toEqual({ message: "First", field: null });
  });
  it.each(["", "?", "?field=title", "?error=", "?errors=no", "?errorMessage=no", "???&%=odd"])("ignores non-refusals %j", (search) => expect(refusalIn(search)).toBeNull());
  it("handles malformed percent encoding and empty field names safely", () => {
    expect(refusalIn("?error=%ZZ&field=")).toEqual({ message: "%ZZ", field: "" });
  });
});
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as ts from "typescript";
