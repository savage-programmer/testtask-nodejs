# TestTask Nodejs

Customer-support chat API: Node.js + Express 5 (ES modules), swappable AI
providers, Zod validation, per-user context, timeouts, fallbacks, rate limiting.
See `DEFENCE.md` for the debugging/defence write-up (Part 4).

## Setup

```
npm install
cp .env.example .env   # fill in keys; .env is gitignored and loaded by npm start
npm start              # http://localhost:3000 (set PORT if 3000 is taken)
npm run dev            # auto-restart on changes
npm test               # 46 tests, built-in Node test runner, no network needed
```

Pick a provider with `AI_PROVIDER` (see `.env.example`): `claude`, `gemini`
(Google AI Studio free tier), `openrouter` (free models), `ollama` (local),
`mock`, or `rules` (offline, default when no Anthropic key is set).

## Endpoints

| Method | Path                | Description                                              |
|--------|---------------------|----------------------------------------------------------|
| POST   | `/chat`             | `{ userId, message }` -> structured analysis (201)       |
| GET    | `/history/:userId`  | That user's conversation history only                    |
| GET    | `/health`           | Service health                                           |
| GET    | `/stats`            | Total messages, users, intent and sentiment counts       |

### POST /chat

```
curl -X POST http://localhost:3000/chat -H "Content-Type: application/json" \
  -d "{\"userId\":\"rahul-001\",\"message\":\"My withdrawal has been pending for 3 hours. Nobody is helping me. I want my money back.\"}"
```

```json
{
  "intent": "withdrawal_issue",
  "sentiment": "negative",
  "priority": "high",
  "language": "English",
  "response": "We understand your concern. Our team will review your withdrawal and update you as soon as possible.",
  "flags": [],
  "userId": "rahul-001",
  "messageId": "…",
  "sequence": 1,
  "source": "gemini",
  "createdAt": "…"
}
```

- `intent`: `deposit_issue` | `withdrawal_issue` | `account_access` | `bonus_query` | `other`
- `sentiment`: `positive` | `neutral` | `negative`; `priority`: `low` | `medium` | `high`
- `language`: detected language; `response` is written in that language
- `flags`: `prompt_injection` (input looked like an injection attempt),
  `unsafe_claim_removed` (model claimed an action was taken; replaced)
- `source`: provider that answered; `fallbackReason` (`timeout` | `invalid_output` |
  `provider_error`) is present when the rule fallback answered instead of the AI

### Validation and errors
- `userId`: 1-64 chars of letters, digits, `_` or `-`; `message`: non-empty, max 2000 chars.
  Both enforced with Zod (`src/middleware/validate.js`); errors list each field.
- 400 invalid payload / JSON, 404 unknown route, 413 body too large,
  429 rate limited (`Retry-After` header), 500 unexpected. All JSON, one central handler.
- Rate limits: per IP (default 120/min, all routes) and per user (default 20/min on `/chat`).

## AI layer (`src/ai/`)

Routes never call a vendor. The chat service depends on one interface:

```js
{ name, analyze({ userId, message, history, signal }) => Promise<Analysis> }
```

| File | Role |
|---|---|
| `schema.js` | Zod `AnalysisSchema` (allowed values, required fields), JSON schema derived from it, `parseAnalysis()` |
| `prompt.js` | Shared system prompt (customer text marked untrusted, no action claims) and `buildTurns()` which replays only the current user's history |
| `guards.js` | Prompt-injection detection and removal of "action taken" claims |
| `wrappers.js` | `withTimeout` (5 s, aborts the HTTP call), `withFallback` (to rules, tags `fallbackReason`), `withGuards` |
| `claudeProvider.js` | Anthropic SDK, structured JSON output |
| `geminiProvider.js` | Gemini REST (`generateContent`, `responseSchema`) |
| `openaiCompatProvider.js` | Any `chat/completions` endpoint: OpenRouter, Ollama, LM Studio, vLLM |
| `mockProvider.js` | Deterministic mock for tests/demos (can return junk, hang or throw) |
| `ruleProvider.js` | Offline keyword classifier + language detection; the fallback |
| `index.js` | `PROVIDERS` registry, `composeProvider()` pipeline, `createAiProvider()` from env |

Pipeline for every AI provider: `guards( fallback( timeout(vendor), rules ) )`.

## Design notes
- **Async**: every handler is `async`; Express 5 routes rejected promises to the error handler.
- **Storage**: in-memory `Map<userId, entry[]>`; histories never mix across users.
- **Context**: the service loads the user's history and passes it to the provider; the
  rule provider escalates repeat contacts, LLM providers get prior turns in the prompt.
- **Concurrency**: each user's turn (load -> analyze -> append) runs through a per-user
  promise queue; two simultaneous requests for one user are both stored, in order.
- **Isolation**: validated `userId` -> keyed store -> `buildTurns` filters by user again.
- **DI**: `createApp({ store, ai, rateLimit })` for tests and provider swaps.
