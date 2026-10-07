#!/usr/bin/env bash
# Re-vendor this library into every consumer, then commit and push each one.
#
# The target list is read OUT of the drift checker rather than kept beside it.
# A hand-written list is how nodeterm stayed stale through two re-vendors: it
# was missing from it, so the loop ran, reported success, and never touched
# the one repo that had drifted. The checker already discovers consumers
# (extra roots and all); this script just acts on whatever it names.
#
# Staging is scoped to vendored paths. `git add -A` in a consumer repo would
# sweep up that project's own half-finished work.
set -u
cd "$(dirname "$0")/.."

MSG=${1:?usage: scripts/revendor.sh <commit-message-file> [ --allow-dirty ]}
CHECK=./scripts/check-design-sync.sh

# install.sh copies the WORKING TREE, so a dirty library ships whatever is
# on disk - including another agent's half-finished refactor. That happened:
# a z-index scale was vendored into ten repos minutes before it was
# committed upstream. Refuse by default; --allow-dirty is the explicit call.
ALLOW_DIRTY=0
[ "${2:-}" = "--allow-dirty" ] && ALLOW_DIRTY=1
dirty=$(git status --porcelain -- src/ || true)
if [ -n "$dirty" ] && [ "$ALLOW_DIRTY" -eq 0 ]; then
	echo "library working tree is dirty - not vendoring someone's WIP:"
	printf '%s\n' "$dirty"
	echo "commit it first, or pass --allow-dirty if that is deliberate."
	exit 2
fi
FILTER='(^|/)(cli-mono|theme-guard)'

out=$("$CHECK" 2>&1) || true
targets=$(printf '%s\n' "$out" | sed -n 's/^in sync  *//p; s/^drift in *//p' | sort -u)
[ -n "$targets" ] || { echo "no consumers discovered - check $CHECK"; exit 1; }

status=0
while IFS= read -r t; do
	[ -n "$t" ] || continue
	./scripts/install.sh "$t" >/dev/null 2>&1

	if [ ! -d "$t/.git" ]; then
		printf '%-36s installed (not a git repo: nothing to commit)\n' "$t"
		continue
	fi

	files=$(git -C "$t" diff --name-only HEAD | grep -E "$FILTER" || true)
	if [ -z "$files" ]; then
		printf '%-36s already current\n' "$t"
		continue
	fi

	n=$(printf '%s\n' "$files" | wc -l | tr -d ' ')
	printf '%s\n' "$files" | while IFS= read -r f; do git -C "$t" add -- "$f" || exit 1; done || { printf '%-36s STAGE FAILED\n' "$t"; status=1; continue; }
	git -C "$t" -c user.name=omiinaya -c user.email=omiinaya@users.noreply.github.com \
		commit -F "$MSG" >/dev/null || { printf '%-36s COMMIT FAILED\n' "$t"; status=1; continue; }

	if git -C "$t" remote get-url origin >/dev/null 2>&1; then
		if git -C "$t" push >/dev/null 2>&1; then
			printf '%-36s %s file(s) pushed\n' "$t" "$n"
		else
			printf '%-36s committed, PUSH FAILED\n' "$t"
			status=1
		fi
	else
		printf '%-36s %s file(s) committed locally (no remote)\n' "$t" "$n"
	fi
done <<EOF
$targets
EOF

exit $status
