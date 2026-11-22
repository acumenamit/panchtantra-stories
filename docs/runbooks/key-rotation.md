# Key rotation and the publisher workflows

The owner's runbook for every value the storyboard project keeps, secret or public, and for the
publisher workflows run from the Actions tab, on the iPad too. It names each value and never shows
one: no key, token, password, hook URL, project ref or account email belongs in this file, in a
workflow input, an issue, a commit or a chat. Never type a secret value in chat; the lead never asks
for one. When a step below needs a new value, paste it straight into the provider's own settings
page.

## 1. Where each value lives

- Supabase secret key `SUPABASE_SECRET_KEY`. Two keys exist: this PC's, in `storyboard/.env.local`,
  and a separate secret key for Actions, held as a secret of the GitHub Environment `publisher`. It
  is never in Vercel, never a repository secret, never a workflow input, an issue, a commit or a chat.
- `SUPABASE_URL`, the project's public URL: in `storyboard/.env.local` and as an Environment
  `publisher` secret. (keep-alive reads a repository variable of the same name; it is public too.)
- Deploy hook `VERCEL_DEPLOY_HOOK_PRODUCTION`. Two hooks exist: this PC's, in
  `storyboard/.env.local`, and a separate deploy hook for Actions, held as an Environment `publisher`
  secret. Both are created in the Vercel project's settings. Anyone who holds a hook can start a
  production build, so it is treated as a secret.
- `NEXT_PUBLIC_SITE_URL`, the production site's public address: Vercel's Production environment and
  the Environment `publisher` variable.
- Publishable key `SUPABASE_PUBLISHABLE_KEY`: a repository variable that only keep-alive reads. It
  is public by design; keep-alive refuses any value that does not start with `sb_publishable_`.
- `READER_DB_URL`: Vercel Production only, marked Sensitive, never Preview. It holds the
  `reader_writer` login, which may only call the two reader functions.
- Hugging Face token `HF_TOKEN`: the owner's Colab secret for the narration notebook.

The Environment `publisher` (Settings, Environments) holds the three publisher secrets
`SUPABASE_URL`, `SUPABASE_SECRET_KEY` and `VERCEL_DEPLOY_HOOK_PRODUCTION`, and the variable
`NEXT_PUBLIC_SITE_URL`. Its deployment branch rule allows `main` only, and it has no required
reviewer. No repository secret holds a publisher value, and no secret or variable is named
`ACTIONS_STEP_DEBUG` or `ACTIONS_RUNNER_DEBUG`.

## 2. The order of every rotation

1. Create the new value at the provider.
2. Update every place in section 1 that holds it.
3. Prove that the new value works.
4. Revoke the old value.
5. Confirm that the old value is gone from the provider's list.

Each of the two Supabase secret keys and each of the two deploy hooks rotates on its own: rotating
the one for Actions never touches this PC, and rotating this PC's never touches Actions.

## 3. Supabase secret key

1. Supabase Dashboard, Project Settings, API keys: create a new secret key, either the one for this
   PC or the one for Actions.
2. Update that one place: `storyboard/.env.local` for this PC's key, or the Environment `publisher`
   secret `SUPABASE_SECRET_KEY` for the key for Actions.
3. Prove it. On this PC, run `corepack pnpm publisher verify` from `storyboard`. For the key for
   Actions, dispatch `publisher-verify` with mode `run` from `main`. The stop line must not be
   `storage-unauthorized`. Until the first production publish, verify ends `production-missing`,
   which still proves that the key reads Storage.
4. Delete the old key in the Dashboard.
5. Check that the API keys list no longer shows it.

## 4. Deploy hook

1. Vercel, the project, Settings, Git, Deploy Hooks: create a hook for the branch `main`, either
   this PC's or the one for Actions.
2. Update that one place: `storyboard/.env.local`, or the Environment `publisher` secret
   `VERCEL_DEPLOY_HOOK_PRODUCTION`.
3. Delete the old hook, and check that the list no longer shows it.
4. The next publish proves the new hook: its hook step must succeed.

## 5. Publishable key

1. Supabase Dashboard, Project Settings, API keys: create a new publishable key.
2. Update the repository variable `SUPABASE_PUBLISHABLE_KEY` (Settings, Secrets and variables,
   Actions, Variables).
3. Dispatch keep-alive and wait for green.
4. Delete the old publishable key, and check that the list no longer shows it.

## 6. READER_DB_URL

1. Supabase: reset the password of the `reader_writer` database role.
2. Vercel, the project's Production environment variables: replace `READER_DB_URL` with the new
   connection string (Sensitive, Production only, never Preview).
3. Redeploy Production.
4. Check that the report and count endpoints still answer: a report sent from the site arrives, and
   a story counter still grows.

## 7. Hugging Face token

1. Hugging Face, Settings, Access Tokens: create a new read token.
2. Update the Colab secret `HF_TOKEN`.
3. Run the notebook's first cells to prove that the token loads the model.
4. Delete the old token, and check that the token list no longer shows it.

## 8. A suspected leak

A value seen in a log, a screenshot, a chat, an issue or a commit counts as leaked.

1. First revoke and rotate the value at once (sections 3 to 7), so the leaked value stops working.
2. Only then remove the copy. For an Actions run, open the run and choose Delete all logs. For a
   commit, tell the lead: a public commit stays readable in clones and forks, which is why step 1
   comes first.
3. For the Supabase secret key, run `verify --deep` (this PC: `corepack pnpm publisher verify
   --deep`; Actions: `publisher-verify` with mode `run` and deep on) and read its mismatch count.
   Anything but 0 is a finding for the lead.
4. keep-alive's own check says to rotate the key in Supabase at once if a secret key is ever pasted
   into its variable; then delete that run's logs as in step 2.

## 9. Cadence

Rotate at once after any suspected leak (section 8). Otherwise rotate each value once a year. The
spec sets no cadence, so once a year is the lead's default.

## 10. Publisher workflows from the iPad

Four workflows run the publisher: `publisher-approve`, `publisher-publish` (story ids, `--feature`
and `--snapshot`), `publisher-unpublish` and `publisher-verify` (`--deep`). Each runs only when
dispatched from the Actions tab (Run workflow).

- Modes: `fixtures`, the default, runs on an in-memory fixture store with no secret and makes no
  Storage, deploy hook or site request; `dry-run` reads Storage and writes nothing; `run` is the
  real command. `publisher-verify` offers `fixtures` and `run` only.
- Dispatch `dry-run` and `run` from `main` only. From any other branch the run fails at its
  refuse-ref job. A branch named `main` in other letter case (`Main`, `MAIN`) passes that check, so
  its storage job is refused instead: by the Environment `publisher`'s `main`-only branch rule
  (section 1), or else by its last step with `dispatch: storage modes run from main only`. Once that
  branch rule is set, GitHub also refuses the Environment's jobs on any other branch.
- One at a time: a storage job waits while another runs, and
  a third dispatch cancels the waiting one, which did nothing. Dispatch, wait for green, then
  dispatch the next.
- Inputs may be public on the run page, so put nothing private there. The log shows only step
  names, the fixtures line and the publisher's fixed lines.
- Never use Re-run on a publisher run that reads or writes Storage: dispatch a new run from main.
  The dispatch helper refuses a re-run.
- Never cancel a running storage job. If one was cancelled or timed out, dispatch
  `publisher-verify` with mode `run` from `main` to read the state, then dispatch the same command
  again from `main`.
- Never enable debug logging on a publisher run, and never add an `ACTIONS_STEP_DEBUG` or
  `ACTIONS_RUNNER_DEBUG` secret or variable: debug output is public.
- Do not run the publisher on this PC while an Actions storage job runs.
- `--takedown` runs on this PC only; no workflow offers it.

The fixture dry runs (mode `fixtures`) take the values below; leave every other input empty.
`publisher-verify` needs no value: run it with deep off, then with deep on.

| Input | Value |
|---|---|
| approve story-id | `lantern-walk` |
| approve package-prefix | `8aa14f165505` |
| languages-read | `en,hi` |
| all-nodes-read | `yes` |
| images-viewed | `1` |
| narration-check | `checked` |
| devices | `phone, laptop` |
| checklist-complete | `yes` |
| publish story-ids | `river-stones` |
| publish feature | `two-paths` |
| publish snapshot | `1` |
| unpublish story-id | `river-stones` |

`publisher-publish` takes one of its three values per dispatch: the story ids, the feature or the
snapshot. `publisher-approve` takes all eight of its values in one dispatch. Each fixtures run ends
green and its log names no answer, key or URL.

## 11. GitHub's 60-day rule (NI-5)

GitHub disables a scheduled workflow in a public repository after 60 days without repository
activity. keep-alive runs on a schedule and warns at 45 days; the owner's NI-5 reminder is a commit
or a workflow re-enable about every 50 days. The publisher workflows have no schedule, so the rule
should not stop them (an inference: GitHub's rule speaks of scheduled workflows). Before a release,
still check that the Actions tab shows all four of them enabled.
