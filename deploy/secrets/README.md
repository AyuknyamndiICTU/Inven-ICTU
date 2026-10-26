# deploy/secrets

Docker secrets mounted read-only into the API and worker at `/run/secrets/`. Files here are git-ignored.

| File                  | Content                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------ |
| `desfire_master_keys` | DESFire LAK master keys, `<version>:<32 hex>` per line (ADR-0008). Empty until cards ship. |

Create the file before the first `docker compose up` (an empty file is valid and keeps UID-only card mode):

```sh
install -m 600 /dev/null deploy/secrets/desfire_master_keys
```
