# pii-llm-lab

Masking personal data before an LLM call and restoring it afterwards — for support
tickets written in Russian, Hebrew and English, often in one message.

The common recipe is "replace names with `<PERSON_1>`, call the model, put them back".
This repository shows where that recipe breaks and what it takes to make it hold:
a support pipeline you can run, tests for each failure, a property test over generated
mixed-language tickets, a mutation check, and an eval for real models behind LiteLLM.

```bash
npm install
npm test                 # 92 tests, including 1,000 generated tickets
bash scripts/mutants.sh  # 8 deliberate privacy bugs; every one must be caught
npm run eval             # offline, with a scripted model
LITELLM_BASE_URL=http://localhost:4000 LITELLM_API_KEY=sk-... \
MODELS=model-a,model-b RUNS=3 npm run eval   # real models
```

## The scenario

A customer writes to support about a duplicate card charge. The model must find the
charges, propose refunding one, and draft a reply. It never sees a real value:

```text
in   Здравствуйте, я Давид Коэн, ת.ז. 123456782. 3 сентября с карты ...4417 списали 1 250 ₪ дважды...
sent Здравствуйте, я <CUSTOMER_FULL_NAME>, ת.ז. <NATIONAL_ID_1>. <DATE_1> с карты ...<CARD_1> списали <AMOUNT_1> дважды...
tool find_charges({date: <DATE_1>, amount: <AMOUNT_1>, card: <CARD_1>}) -> [<TXN_1>, <TXN_2>]
tool propose_refund({charge: <TXN_2>}) -> awaiting human approval
out  ... Мы сообщим <CUSTOMER_FIRST_NAME:dat> о решении ...
     ... Мы сообщим Давиду о решении ...
```

## Design

1. **Mask from the customer record first.** In support you know who wrote the ticket.
   Their name (every script, every Russian case form, with Hebrew one-letter prefixes),
   ID number and e-mails are found by exact match, not guessed. Cards and phones are left
   to patterns: a bare four-digit card ending would also match years and amounts. Patterns
   cover the rest: dates and amounts in three languages, any valid Israeli ID (check digit),
   phones, e-mails, card endings after a card cue.
2. **Role tokens for the customer** (`<CUSTOMER_FIRST_NAME>`), numbered tokens for other
   values (`<DATE_1>`). The same value always gets the same token.
3. **The model computes nothing with real values.** Tools run on our side: they accept
   tokens, use real values, return tokens. They are scoped to the authenticated customer,
   refuse raw values, and `propose_refund` moves no money — a human approves it.
4. **Restore in the language around each token**, in the right Russian case. The prompt
   asks for case markers (`<CUSTOMER_FIRST_NAME:dat>`); suffixes glued to tokens and
   mangled tokens are repaired.
5. **Fail closed.** An invented token or an internal one (`<TXN_2>`) in the reply blocks
   it for human review instead of sending it.

## What breaks, and what catches it

| Failure | Where it is handled | Test |
| --- | --- | --- |
| `Коэна`, `Давиду` — case forms of the name | masking generates the case forms | mask, property |
| `Ирины` — a first name declined as if it were a surname (Ильина → Ильиной) | first names and surnames decline separately | mask, restore, property |
| `לדוד` — Hebrew prefix glued to the name | prefix kept outside the token | mask, property |
| `david.cohen@example.com` split by the name inside it | e-mails matched before names | mask |
| Model writes `<CUSTOMER_FIRST_NAME>у` | suffix → case | restore |
| Model writes `< customer first name >`, `\<AMOUNT\_1\>`, `CARD_1` | normalised | restore |
| Model invents `<DATE_2>` or shows `<TXN_2>` | reply blocked | restore, pipeline |
| Model passes `2026-09-03` to a tool | tool refuses raw values | pipeline |
| Tool returns a real value | — | pipeline, property |
| Model leaves a name in the nominative where Russian needs another case | **not detectable** | eval (read the replies) |

`scripts/mutants.sh` reintroduces eight of these bugs one at a time:

```text
killed    Hebrew prefixes not handled (לדוד leaks)
killed    Russian case forms not generated (Коэна leaks)
killed    first names declined as surnames (Ирины leaks)
killed    names matched before e-mails (address split)
killed    tool returns the real date
killed    restore accepts invented tokens
killed    restore shows internal tokens
killed    tool accepts raw values
```

One lesson from building it: the first version of the leak checker searched for whole
words, so it could not see `לדוד` — exactly the bug it was meant to catch. The property
test passed with the Hebrew-prefix bug in place until the checker learned Hebrew prefixes too.

The same lesson, a second time, found by an independent review: `Ирина` was declined by the
rule for surnames like `Ильина`, so `Ирины` and `Ирине` reached the model. Nothing failed,
because the leak checker and the property-test generator both took their name forms from the
same declension code. The generator now uses case forms written by hand, and the leak check
adds them to its list. A test built on the code it is testing inherits that code's blind spots.

## Known gaps (see `test/known-gaps.test.ts`)

- **Other people's names are not masked.** "My wife Sarah Mizrahi..." reaches the model.
  That needs a named-entity model with its own error rate. The eval counts it as a leak.
- **Over-masking.** A merchant whose name contains the customer's surname is masked too:
  Моше Леви shopping at רמי לוי (Rami Levy) becomes `רמי <CUSTOMER_LAST_NAME>`, and the model
  loses the merchant. Exact matching from the customer record trades this for not missing the name.
- A card ending written without a card cue ("списали с 4417") is not masked.
- Free text can identify a person without any listed field: a small town, a rare story.
- Russian declension covers common first-name and surname patterns, not all of them
  (e.g. adjectival surnames like -ский).
- Masked data that you can restore is still personal data under GDPR: masking reduces
  what the model provider sees, it does not take the processing out of scope.

## Eval

`npm run eval` runs the fixtures in `fixtures/tickets.ts` (fictional people, valid
check digits) through each model and reports leaks, tool errors, refund proposals,
replies that could be restored, invented or internal tokens, and how Russian name tokens
were written. Full results, including every restored reply, go to `eval-results/`.

### Results with Claude Haiku, Sonnet and Opus

These replies were collected without LiteLLM: `scripts/agent-prompts.ts` writes, for each
fixture, exactly what the model sees when it writes the reply (system prompt, masked
ticket, its tool calls and their tokenised results). Each prompt was given to a
context-free Claude agent, and `scripts/score-replies.ts` restores the replies saved in
`eval-results/claude-agents-replies.json`:

| model | replies | restored OK | invented / internal tokens | tokens copied exactly | with case marker | glued | mangled |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Haiku | 9 | 9/9 | 0 | 33 | 2 | 0 | 0 |
| Sonnet | 9 | 9/9 | 0 | 38 | 2 | 0 | 0 |
| Opus | 9 | 9/9 | 0 | 38 | 2 | 0 | 0 |

What the replies show:

- **Tokens survive.** No invented, internal, mangled or glued tokens in 27 replies.
- **Models avoid the hard case.** Almost every Russian reply puts the name only in the
  greeting, in the nominative ("Здравствуйте, Давид!"), where no declension is needed.
- **Forced into it, markers mostly work.** Fixture 7 asks for a document "на имя ...",
  which needs the genitive. 5 of 6 replies used `<CUSTOMER_FULL_NAME:gen>` → "Давида Коэна".
  One Haiku reply left the token bare: "на имя Давид Коэн". The restorer cannot see that.
- **Markers can be wrong.** One Haiku reply wrote `Здравствуйте, <CUSTOMER_FULL_NAME:dat>!`.
  The name (Моше Леви) does not decline, so the text came out right by luck.

So the risk is on the input side (masking and the leak checker), not on the way back.

Limits of this run: Claude models only; one or two runs per ticket; agents, not the raw API;
the tool calls were given, not made by the model. Run `npm run eval` with your own models
behind LiteLLM for numbers that matter to you.

## License

MIT
