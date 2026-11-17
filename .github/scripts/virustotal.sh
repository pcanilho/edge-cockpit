#!/usr/bin/env bash
# Scans exes with VirusTotal and writes, into the directory given first:
#   virustotal.md    a "### VirusTotal" section for the release notes, with a link and result per exe
#   virustotal.json  a shields.io endpoint badge for the README
# Usage: VT_API_KEY=... virustotal.sh <out dir> <exe>...
# The free API allows 4 requests a minute, hence the pauses.
set -euo pipefail
out=$1; shift
api=https://www.virustotal.com/api/v3
vt() { sleep 16; curl -sSf -H "x-apikey: $VT_API_KEY" "$@"; }

flagged=0; engines=0
{ echo; echo "### VirusTotal"; } > "$out/virustotal.md"
for f in "$@"; do
  name=$(basename "$f")
  sha=$(sha256sum "$f" | cut -d' ' -f1)
  stats=
  if id=$(vt -X POST "$api/files" --form file=@"$f" | jq -r .data.id); then
    for _ in $(seq 1 20); do
      a=$(vt "$api/analyses/$id") || break
      if [ "$(jq -r .data.attributes.status <<<"$a")" = completed ]; then stats=$(jq -c .data.attributes.stats <<<"$a"); break; fi
    done
  fi
  # A file VirusTotal already knows may not get a fresh analysis: use its last report.
  [ -n "$stats" ] || stats=$(vt "$api/files/$sha" | jq -c .data.attributes.last_analysis_stats) || stats=
  link="https://www.virustotal.com/gui/file/$sha"
  if [ -n "$stats" ] && [ "$stats" != null ]; then
    bad=$(jq '.malicious + .suspicious' <<<"$stats")
    n=$(jq '.malicious + .suspicious + .undetected + .harmless' <<<"$stats")
    # The badge shows the worst exe, not a sum across them.
    flagged=$((bad > flagged ? bad : flagged)); engines=$((n > engines ? n : engines))
    echo "- [$name]($link): flagged by $bad of $n engines" >> "$out/virustotal.md"
  else
    echo "::warning::No VirusTotal result for $name yet"
    echo "- [$name]($link)" >> "$out/virustotal.md"
  fi
done

if [ "$engines" -eq 0 ]; then msg="scanned"; color=394EFF
elif [ "$flagged" -eq 0 ]; then msg="clean · 0/$engines"; color=brightgreen
# A few heuristic hits are usual for unsigned installers; more is worth a look.
elif [ "$flagged" -le 3 ]; then msg="$flagged/$engines engines"; color=yellowgreen
else msg="$flagged/$engines engines"; color=orange
fi
jq -n --arg m "$msg" --arg c "$color" '{schemaVersion: 1, label: "VirusTotal", message: $m, color: $c, namedLogo: "virustotal", logoColor: "white"}' > "$out/virustotal.json"
