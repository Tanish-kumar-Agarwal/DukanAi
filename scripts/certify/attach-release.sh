#!/usr/bin/env bash
# Attaches the certification evidence bundle to the GitHub release of a tag
# (roadmap 9.12). The release is created as a DRAFT when the tag has none, so
# the owner publishes it after reading the evidence; an asset of the same
# name is replaced (a re-run of the job). Plain REST calls with the
# workflow's own token (contents: write); no third-party action.
#
#   GITHUB_TOKEN=... GITHUB_REPOSITORY=owner/repo scripts/certify/attach-release.sh v1.2.3 certification-v1.2.3.tar.gz
set -euo pipefail
TAG="${1:?usage: attach-release.sh TAG FILE}"
FILE="${2:?usage: attach-release.sh TAG FILE}"
: "${GITHUB_TOKEN:?GITHUB_TOKEN is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY (owner/repo) is required}"
API="${GITHUB_API_URL:-https://api.github.com}"
[ -f "$FILE" ] || { echo "no such file: $FILE" >&2; exit 2; }
NAME="$(basename "$FILE")"

gh_api() {
  curl -fsS -H "Authorization: Bearer $GITHUB_TOKEN" -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28" "$@"
}
json_field() { node -e 'let b="";process.stdin.on("data",(d)=>b+=d).on("end",()=>{const v=JSON.parse(b)[process.argv[1]];process.stdout.write(v===undefined||v===null?"":String(v))})' "$1"; }

release="$(gh_api "$API/repos/$GITHUB_REPOSITORY/releases/tags/$TAG" 2>/dev/null || true)"
if [ -z "$release" ]; then
  echo "no release for $TAG yet: creating a draft"
  body="$(node -e 'process.stdout.write(JSON.stringify({tag_name:process.argv[1],name:process.argv[1],draft:true,body:"Certification evidence of the release candidate images (roadmap 9.12) is attached as "+process.argv[2]+"; see its SUMMARY.md. Publish once the evidence has been read."}))' "$TAG" "$NAME")"
  release="$(gh_api -X POST "$API/repos/$GITHUB_REPOSITORY/releases" -d "$body")"
fi
id="$(printf '%s' "$release" | json_field id)"
[ -n "$id" ] || { echo "could not read the release id" >&2; exit 1; }
upload_url="$(printf '%s' "$release" | json_field upload_url)"
upload_url="${upload_url%%\{*}"

# Replace an asset of the same name (idempotent re-runs).
existing="$(gh_api "$API/repos/$GITHUB_REPOSITORY/releases/$id/assets?per_page=100" | node -e 'let b="";process.stdin.on("data",(d)=>b+=d).on("end",()=>{const a=JSON.parse(b).find((x)=>x.name===process.argv[1]);process.stdout.write(a?String(a.id):"")})' "$NAME")"
if [ -n "$existing" ]; then
  echo "replacing the existing asset $NAME (id $existing)"
  gh_api -X DELETE "$API/repos/$GITHUB_REPOSITORY/releases/$id/assets/$existing" >/dev/null
fi
gh_api -X POST -H "Content-Type: application/gzip" --data-binary "@$FILE" "$upload_url?name=$NAME" | json_field browser_download_url
echo
echo "attached $NAME to release $id ($TAG)$( [ "$(printf '%s' "$release" | json_field draft)" = true ] && echo ', a draft until the owner publishes it' )"
