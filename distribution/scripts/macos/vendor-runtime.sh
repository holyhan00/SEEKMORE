#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "[Vendor] macOS vendor-runtime.sh must run on macOS." >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
ARCH="$(uname -m)"

case "$ARCH" in
  arm64)
    TARGET="darwin-arm64"
    ;;
  x86_64)
    TARGET="darwin-x64"
    ;;
  *)
    echo "[Vendor] Unsupported macOS architecture: $ARCH" >&2
    exit 1
    ;;
esac

LOCK="$ROOT/distribution/runtime-lock.json"

export MACOSX_DEPLOYMENT_TARGET="13.5"

VENDOR="$ROOT/distribution/vendor/$TARGET"
CACHE="$ROOT/distribution/.cache/$TARGET"
RUNTIME="$VENDOR/resources/runtime"
LICENSES="$VENDOR/licenses"

mkdir -p "$CACHE" "$RUNTIME" "$LICENSES"

lock_value() {
  node - "$LOCK" "$TARGET" "$1" <<'NODE'
const fs = require('node:fs');
const [lockPath, target, key] = process.argv.slice(2);
const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
const values = {
  nodeVersion: lock.node.version,
  nodeArchive: lock.node.targets[target].archive,
  nodeUrl: lock.node.targets[target].url,
  nodeSha: lock.node.targets[target].sha256,
  postgresVersion: lock.postgresql.version,
  postgresArchive: lock.postgresql.source.archive,
  postgresUrl: lock.postgresql.source.url,
  postgresSha: lock.postgresql.source.sha256,
  pgvectorVersion: lock.pgvector.version,
  pgvectorRepository: lock.pgvector.repository,
  pgvectorTag: lock.pgvector.tag,
  pgvectorCommit: lock.pgvector.commit,
  cacheProvider: lock.cacheRuntime.targets[target].provider,
  cacheVersion: lock.cacheRuntime.targets[target].version,
  cacheArchive: lock.cacheRuntime.targets[target].source.archive,
  cacheUrl: lock.cacheRuntime.targets[target].source.url,
  cacheSha: lock.cacheRuntime.targets[target].source.sha256,
};
if (!(key in values) || values[key] == null) {
  throw new Error(`runtime-lock.json has no value for ${key} on ${target}`);
}
process.stdout.write(String(values[key]));
NODE
}

NODE_VERSION="$(lock_value nodeVersion)"
NODE_ARCHIVE="$(lock_value nodeArchive)"
NODE_URL="$(lock_value nodeUrl)"
NODE_SHA="$(lock_value nodeSha)"

POSTGRES_VERSION="$(lock_value postgresVersion)"
POSTGRES_ARCHIVE="$(lock_value postgresArchive)"
POSTGRES_URL="$(lock_value postgresUrl)"
POSTGRES_SHA="$(lock_value postgresSha)"

PGVECTOR_VERSION="$(lock_value pgvectorVersion)"
PGVECTOR_REPOSITORY="$(lock_value pgvectorRepository)"
PGVECTOR_TAG="$(lock_value pgvectorTag)"
PGVECTOR_EXPECTED_COMMIT="$(lock_value pgvectorCommit)"

CACHE_PROVIDER="$(lock_value cacheProvider)"
VALKEY_VERSION="$(lock_value cacheVersion)"
VALKEY_ARCHIVE="$(lock_value cacheArchive)"
VALKEY_URL="$(lock_value cacheUrl)"
VALKEY_SHA="$(lock_value cacheSha)"

if [[ "$CACHE_PROVIDER" != "Valkey" ]]; then
  echo "[Vendor] Expected Valkey cache provider for $TARGET, got: $CACHE_PROVIDER" >&2
  exit 1
fi

verify_sha() {
  local file="$1"
  local sha="$2"

  echo "$sha  $file" | shasum -a 256 -c -
}

curl_download() {
  local url="$1"
  local output="$2"

  curl \
    --http1.1 \
    --fail \
    --location \
    --retry 5 \
    --retry-all-errors \
    --retry-delay 2 \
    --connect-timeout 30 \
    --output "$output" \
    "$url"
}

curl_resume_download() {
  local url="$1"
  local output="$2"

  curl \
    --http1.1 \
    --fail \
    --location \
    --retry 5 \
    --retry-all-errors \
    --retry-delay 2 \
    --connect-timeout 30 \
    --continue-at - \
    --output "$output" \
    "$url"
}

fetch_verify() {
  local url="$1"
  local file="$2"
  local sha="$3"
  local part="${file}.part"

  mkdir -p "$(dirname "$file")"

  #
  # Reuse an existing cache file only if its SHA-256 matches
  # the pinned release checksum.
  #
  if [[ -f "$file" ]]; then
    if verify_sha "$file" "$sha" >/dev/null 2>&1; then
      echo "[Vendor] Cache hit: $(basename "$file")"
      verify_sha "$file" "$sha"
      return
    fi

    echo "[Vendor] Cached file failed checksum, removing: $file" >&2
    rm -f "$file"
  fi

  #
  # Resume an interrupted .part download when possible.
  #
  if [[ -f "$part" ]]; then
    echo "[Vendor] Resuming download: $(basename "$file")"

    if ! curl_resume_download "$url" "$part"; then
      echo "[Vendor] Resume failed; restarting download from zero: $(basename "$file")" >&2

      rm -f "$part"

      curl_download "$url" "$part"
    fi
  else
    echo "[Vendor] Downloading: $(basename "$file")"

    curl_download "$url" "$part"
  fi

  #
  # Never promote an unverified payload into the official cache.
  #
  if ! verify_sha "$part" "$sha"; then
    echo "[Vendor] Download checksum failed: $part" >&2
    rm -f "$part"
    exit 1
  fi

  #
  # Promote only a complete and verified payload.
  #
  mv -f "$part" "$file"

  echo "[Vendor] Download verified: $(basename "$file")"
}

clone_pgvector() {
  local repository="$PGVECTOR_REPOSITORY"
  local destination="$CACHE/pgvector"

  rm -rf "$destination"

  echo "[Vendor] Cloning pgvector $PGVECTOR_TAG"

  for attempt in 1 2 3 4 5; do
    echo "[Vendor] pgvector clone attempt $attempt/5"

    rm -rf "$destination"

    if git \
      -c http.version=HTTP/1.1 \
      clone \
      --quiet \
      --depth 1 \
      --branch "$PGVECTOR_TAG" \
      "$repository" \
      "$destination"
    then
      echo "[Vendor] pgvector clone completed."
      return
    fi

    echo "[Vendor] pgvector clone failed on attempt $attempt/5." >&2

    rm -rf "$destination"

    if [[ "$attempt" -lt 5 ]]; then
      sleep $((attempt * 2))
    fi
  done

  echo "[Vendor] Failed to clone pgvector after 5 attempts." >&2
  exit 1
}

#
# Make the source-built PostgreSQL runtime relocatable before it enters Stage.
# PostgreSQL is configured with an absolute --prefix so pg_config/PGXS can build
# pgvector against the vendored tree. Mach-O load commands must not retain that
# build-machine path in the final runtime.
#
postgres_macho_files() {
  find "$RUNTIME/postgres" -type f -print0 |
  while IFS= read -r -d '' file_path; do
    if file "$file_path" | grep -q 'Mach-O'; then
      printf '%s\0' "$file_path"
    fi
  done
}

postgres_otool_dependencies() {
  local file_path="$1"

  otool -L "$file_path" |
    tail -n +2 |
    sed -E 's/^[[:space:]]+(.+)[[:space:]]+\(compatibility version.*$/\1/' |
    sed '/^[[:space:]]*$/d'
}

postgres_otool_rpaths() {
  local file_path="$1"

  otool -l "$file_path" |
    awk '
      $1 == "cmd" && $2 == "LC_RPATH" {
        in_rpath = 1
        next
      }
      in_rpath && $1 == "path" {
        line = $0
        sub(/^[[:space:]]*path[[:space:]]+/, "", line)
        sub(/[[:space:]]+\(offset[[:space:]]+[0-9]+\).*$/, "", line)
        print line
        in_rpath = 0
      }
    '
}

postgres_relative_loader_path() {
  local source_file="$1"
  local target_file="$2"

  "$RUNTIME/node/bin/node" - "$source_file" "$target_file" <<'NODE'
const path = require('node:path');
const [sourceFile, targetFile] = process.argv.slice(2);
const relative = path
  .relative(path.dirname(sourceFile), targetFile)
  .split(path.sep)
  .join('/');
process.stdout.write(
  relative && relative !== '.'
    ? `@loader_path/${relative}`
    : '@loader_path',
);
NODE
}

relocate_postgres_runtime() {
  local postgres_root="$RUNTIME/postgres"
  local file_path
  local dependency
  local rpath
  local replacement
  local install_id

  echo "[Vendor] Relocating PostgreSQL Mach-O dependencies."

  while IFS= read -r -d '' file_path; do
    while IFS= read -r dependency; do
      [[ -n "$dependency" ]] || continue

      if [[ "$dependency" == "$postgres_root/"* ]]; then
        replacement="$(postgres_relative_loader_path "$file_path" "$dependency")"

        echo "[Vendor]   $(basename "$file_path"):"
        echo "[Vendor]     $dependency"
        echo "[Vendor]     -> $replacement"

        install_name_tool \
          -change "$dependency" "$replacement" \
          "$file_path"
      fi
    done < <(postgres_otool_dependencies "$file_path")

    while IFS= read -r rpath; do
      [[ -n "$rpath" ]] || continue

      if [[ "$rpath" == "$postgres_root/"* ]]; then
        replacement="$(postgres_relative_loader_path "$file_path" "$rpath")"

        echo "[Vendor]   rpath $(basename "$file_path"):"
        echo "[Vendor]     $rpath"
        echo "[Vendor]     -> $replacement"

        install_name_tool \
          -rpath "$rpath" "$replacement" \
          "$file_path"
      fi
    done < <(postgres_otool_rpaths "$file_path")

    if [[ "$file_path" == *.dylib ]]; then
      install_id="$(
        otool -D "$file_path" 2>/dev/null |
          tail -n +2 |
          head -n 1 |
          sed '/^[[:space:]]*$/d' || true
      )"

      if [[ -n "$install_id" && "$install_id" == "$postgres_root/"* ]]; then
        replacement="@loader_path/$(basename "$file_path")"

        echo "[Vendor]   dylib id $(basename "$file_path"):"
        echo "[Vendor]     $install_id"
        echo "[Vendor]     -> $replacement"

        install_name_tool \
          -id "$replacement" \
          "$file_path"
      fi
    fi
  done < <(postgres_macho_files)
}

is_portable_macos_dynamic_path() {
  local value="$1"

  case "$value" in
    @loader_path|@loader_path/*|@executable_path|@executable_path/*|@rpath|@rpath/*)
      return 0
      ;;
    /usr/lib/*|/System/Library/*)
      return 0
      ;;
    /*)
      return 1
      ;;
    *)
      return 0
      ;;
  esac
}

verify_postgres_macho_relocation() {
  local file_path
  local dependency
  local rpath
  local install_id
  local failed=0

  echo "[Vendor] Verifying PostgreSQL Mach-O relocatability."

  while IFS= read -r -d '' file_path; do
    while IFS= read -r dependency; do
      [[ -n "$dependency" ]] || continue

      if ! is_portable_macos_dynamic_path "$dependency"; then
        echo "[Vendor] Non-relocatable PostgreSQL dependency:" >&2
        echo "[Vendor]   file=$file_path" >&2
        echo "[Vendor]   dependency=$dependency" >&2
        failed=1
      fi
    done < <(postgres_otool_dependencies "$file_path")

    while IFS= read -r rpath; do
      [[ -n "$rpath" ]] || continue

      if ! is_portable_macos_dynamic_path "$rpath"; then
        echo "[Vendor] Non-relocatable PostgreSQL rpath:" >&2
        echo "[Vendor]   file=$file_path" >&2
        echo "[Vendor]   rpath=$rpath" >&2
        failed=1
      fi
    done < <(postgres_otool_rpaths "$file_path")

    if [[ "$file_path" == *.dylib ]]; then
      install_id="$(
        otool -D "$file_path" 2>/dev/null |
          tail -n +2 |
          head -n 1 |
          sed '/^[[:space:]]*$/d' || true
      )"

      if [[ -n "$install_id" ]] && ! is_portable_macos_dynamic_path "$install_id"; then
        echo "[Vendor] Non-relocatable PostgreSQL dylib install id:" >&2
        echo "[Vendor]   file=$file_path" >&2
        echo "[Vendor]   id=$install_id" >&2
        failed=1
      fi
    fi
  done < <(postgres_macho_files)

  if [[ "$failed" -ne 0 ]]; then
    echo "[Vendor] PostgreSQL Mach-O relocatability verification failed." >&2
    exit 1
  fi
}

reserve_loopback_port() {
  "$RUNTIME/node/bin/node" <<'NODE'
const net = require('node:net');
const server = net.createServer();
server.unref();
server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address === 'string') {
    process.exitCode = 1;
    server.close();
    return;
  }
  process.stdout.write(String(address.port));
  server.close();
});
NODE
}

smoke_test_relocated_postgres() (
  set -euo pipefail

  unset DYLD_LIBRARY_PATH
  unset DYLD_FALLBACK_LIBRARY_PATH
  unset DYLD_FRAMEWORK_PATH
  unset DYLD_FALLBACK_FRAMEWORK_PATH

  local source_root="$RUNTIME/postgres"
  local hold_root="$RUNTIME/postgres.__relocation_hold.$$"
  local temp_root
  local postgres_root
  local data_root
  local log_path
  local port
  local result
  local started=0

  temp_root="$(mktemp -d "${TMPDIR:-/tmp}/seekmore-postgres-relocation.XXXXXX")"
  postgres_root="$temp_root/postgres"
  data_root="$temp_root/data"
  log_path="$temp_root/postgres.log"

  cleanup() {
    if [[ "$started" -eq 1 && -x "$postgres_root/bin/pg_ctl" ]]; then
      "$postgres_root/bin/pg_ctl" \
        -D "$data_root" \
        -m fast \
        -w stop \
        >/dev/null 2>&1 || true
    fi

    if [[ -d "$hold_root" && ! -e "$source_root" ]]; then
      mv "$hold_root" "$source_root"
    fi

    rm -rf "$temp_root"
  }

  trap cleanup EXIT

  cp -R "$source_root" "$postgres_root"

  # Hide the original build-prefix tree while the copy is tested. If any
  # executable still depends on the configured vendor prefix, this smoke test
  # must fail instead of accidentally succeeding on the build machine.
  mv "$source_root" "$hold_root"

  port="$(reserve_loopback_port)"

  echo "[Vendor] PostgreSQL relocated smoke root: $postgres_root"
  echo "[Vendor] PostgreSQL relocated smoke port: $port"

  "$postgres_root/bin/initdb" \
    -D "$data_root" \
    -U seekmore \
    --auth-local=trust \
    --auth-host=trust \
    --encoding=UTF8 \
    --no-locale \
    >/dev/null

  "$postgres_root/bin/pg_ctl" \
    -D "$data_root" \
    -l "$log_path" \
    -o "-h 127.0.0.1 -p $port" \
    -w start \
    >/dev/null

  started=1

  "$postgres_root/bin/createdb" \
    -h 127.0.0.1 \
    -p "$port" \
    -U seekmore \
    seekmore_release_smoke

  result="$(
    "$postgres_root/bin/psql" \
      -h 127.0.0.1 \
      -p "$port" \
      -U seekmore \
      -d seekmore_release_smoke \
      -v ON_ERROR_STOP=1 \
      -A \
      -t \
      -c "CREATE EXTENSION vector; SELECT '[1,2,3]'::vector <-> '[1,2,4]'::vector;"
  )"

  if ! printf '%s\n' "$result" | grep -qx '1'; then
    echo "[Vendor] Relocated PostgreSQL pgvector smoke returned unexpected output:" >&2
    echo "$result" >&2
    exit 1
  fi

  "$postgres_root/bin/pg_ctl" \
    -D "$data_root" \
    -m fast \
    -w stop \
    >/dev/null

  started=0

  echo "[Vendor] Relocated PostgreSQL + pgvector smoke passed."
)

#
# Rebuild the final vendored runtime payload.
#
# Download archives remain cached and are independently checksum-verified.
#
rm -rf \
  "$RUNTIME/node" \
  "$RUNTIME/postgres" \
  "$RUNTIME/redis"

#
# Node.js
#
fetch_verify \
  "$NODE_URL" \
  "$CACHE/$NODE_ARCHIVE" \
  "$NODE_SHA"

mkdir -p "$RUNTIME/node"

tar \
  -xzf "$CACHE/$NODE_ARCHIVE" \
  -C "$RUNTIME/node" \
  --strip-components=1

cp \
  "$RUNTIME/node/LICENSE" \
  "$LICENSES/node.txt"

#
# PostgreSQL
#
fetch_verify \
  "$POSTGRES_URL" \
  "$CACHE/$POSTGRES_ARCHIVE" \
  "$POSTGRES_SHA"

rm -rf "$CACHE/postgresql-$POSTGRES_VERSION"

tar \
  -xjf "$CACHE/$POSTGRES_ARCHIVE" \
  -C "$CACHE"

cp \
  "$CACHE/postgresql-$POSTGRES_VERSION/COPYRIGHT" \
  "$LICENSES/postgresql.txt"

pushd "$CACHE/postgresql-$POSTGRES_VERSION" >/dev/null

./configure \
  --prefix="$RUNTIME/postgres" \
  --without-readline \
  --without-zlib \
  --without-icu

make -j"$(sysctl -n hw.ncpu)"
make install

popd >/dev/null

#
# Verify the bundled PostgreSQL toolchain before building pgvector.
#
POSTGRES_PG_CONFIG="$RUNTIME/postgres/bin/pg_config"

if [[ ! -x "$POSTGRES_PG_CONFIG" ]]; then
  echo "[Vendor] Bundled PostgreSQL pg_config is missing or not executable: $POSTGRES_PG_CONFIG" >&2
  exit 1
fi

POSTGRES_SHARED_DIR="$("$POSTGRES_PG_CONFIG" --sharedir)"
POSTGRES_LIBRARY_DIR="$("$POSTGRES_PG_CONFIG" --pkglibdir)"
POSTGRES_PGXS="$("$POSTGRES_PG_CONFIG" --pgxs)"

EXPECTED_POSTGRES_SHARED_DIR="$RUNTIME/postgres/share"
EXPECTED_POSTGRES_LIBRARY_DIR="$RUNTIME/postgres/lib"

echo "[Vendor] Bundled PostgreSQL extension paths:"
echo "[Vendor]   pg_config=$POSTGRES_PG_CONFIG"
echo "[Vendor]   sharedir=$POSTGRES_SHARED_DIR"
echo "[Vendor]   pkglibdir=$POSTGRES_LIBRARY_DIR"
echo "[Vendor]   pgxs=$POSTGRES_PGXS"

if [[ "$POSTGRES_SHARED_DIR" != "$EXPECTED_POSTGRES_SHARED_DIR" ]]; then
  echo "[Vendor] Unexpected bundled PostgreSQL shared directory." >&2
  echo "[Vendor] Expected: $EXPECTED_POSTGRES_SHARED_DIR" >&2
  echo "[Vendor] Actual:   $POSTGRES_SHARED_DIR" >&2
  exit 1
fi

if [[ "$POSTGRES_LIBRARY_DIR" != "$EXPECTED_POSTGRES_LIBRARY_DIR" ]]; then
  echo "[Vendor] Unexpected bundled PostgreSQL library directory." >&2
  echo "[Vendor] Expected: $EXPECTED_POSTGRES_LIBRARY_DIR" >&2
  echo "[Vendor] Actual:   $POSTGRES_LIBRARY_DIR" >&2
  exit 1
fi

if [[ ! -f "$POSTGRES_PGXS" ]]; then
  echo "[Vendor] Bundled PostgreSQL PGXS Makefile is missing: $POSTGRES_PGXS" >&2
  exit 1
fi

#
# pgvector
#
clone_pgvector

cp \
  "$CACHE/pgvector/LICENSE" \
  "$LICENSES/pgvector.txt"

export PG_CONFIG="$POSTGRES_PG_CONFIG"

echo "[Vendor] Building pgvector against bundled PostgreSQL:"
echo "[Vendor]   PG_CONFIG=$PG_CONFIG"

pushd "$CACHE/pgvector" >/dev/null

make clean

make \
  OPTFLAGS="" \
  PG_CONFIG="$PG_CONFIG"

make \
  install \
  PG_CONFIG="$PG_CONFIG"

PGVECTOR_COMMIT="$(git rev-parse HEAD)"

if [[ "$PGVECTOR_COMMIT" != "$PGVECTOR_EXPECTED_COMMIT" ]]; then
  echo "[Vendor] pgvector commit mismatch." >&2
  echo "[Vendor] Expected: $PGVECTOR_EXPECTED_COMMIT" >&2
  echo "[Vendor] Actual:   $PGVECTOR_COMMIT" >&2
  exit 1
fi

popd >/dev/null

#
# Verify pgvector immediately before moving on to Valkey.
#
VECTOR_CONTROL="$POSTGRES_SHARED_DIR/extension/vector.control"
VECTOR_LIBRARY="$POSTGRES_LIBRARY_DIR/vector.dylib"

if [[ ! -f "$VECTOR_CONTROL" ]]; then
  echo "[Vendor] pgvector control file is missing after install: $VECTOR_CONTROL" >&2
  exit 1
fi

if [[ ! -f "$VECTOR_LIBRARY" ]]; then
  echo "[Vendor] pgvector shared library is missing after install: $VECTOR_LIBRARY" >&2
  exit 1
fi

echo "[Vendor] pgvector installed successfully:"
echo "[Vendor]   control=$VECTOR_CONTROL"
echo "[Vendor]   library=$VECTOR_LIBRARY"
echo "[Vendor]   commit=$PGVECTOR_COMMIT"

# pgvector must be installed before relocation because its build consumes the
# absolute pg_config/PGXS prefix. From this point forward the PostgreSQL tree is
# a runtime payload and must be independent of the build-machine path.
relocate_postgres_runtime
verify_postgres_macho_relocation
smoke_test_relocated_postgres

unset PG_CONFIG

#
# Valkey / Redis protocol runtime
#
fetch_verify \
  "$VALKEY_URL" \
  "$CACHE/$VALKEY_ARCHIVE" \
  "$VALKEY_SHA"

rm -rf "$CACHE/valkey-$VALKEY_VERSION"

tar \
  -xzf "$CACHE/$VALKEY_ARCHIVE" \
  -C "$CACHE"

cp \
  "$CACHE/valkey-$VALKEY_VERSION/COPYING" \
  "$LICENSES/valkey.txt"

pushd "$CACHE/valkey-$VALKEY_VERSION" >/dev/null

make \
  -j"$(sysctl -n hw.ncpu)" \
  BUILD_TLS=no

mkdir -p "$RUNTIME/redis"

cp \
  src/valkey-server \
  "$RUNTIME/redis/redis-server"

popd >/dev/null

#
# Required runtime file verification.
#
for TOOL in node npm npx corepack; do
  TOOL_PATH="$RUNTIME/node/bin/$TOOL"

  if [[ ! -x "$TOOL_PATH" ]]; then
    echo "[Vendor] Bundled Node tool is missing or not executable: $TOOL_PATH" >&2
    exit 1
  fi
done

if [[ ! -x "$RUNTIME/postgres/bin/postgres" ]]; then
  echo "[Vendor] Bundled PostgreSQL executable is missing: $RUNTIME/postgres/bin/postgres" >&2
  exit 1
fi

if [[ ! -x "$RUNTIME/postgres/bin/initdb" ]]; then
  echo "[Vendor] Bundled PostgreSQL initdb is missing: $RUNTIME/postgres/bin/initdb" >&2
  exit 1
fi

if [[ ! -x "$RUNTIME/postgres/bin/pg_isready" ]]; then
  echo "[Vendor] Bundled PostgreSQL pg_isready is missing: $RUNTIME/postgres/bin/pg_isready" >&2
  exit 1
fi

if [[ ! -x "$RUNTIME/redis/redis-server" ]]; then
  echo "[Vendor] Bundled Redis-protocol server is missing: $RUNTIME/redis/redis-server" >&2
  exit 1
fi

#
# Required third-party license verification.
#
for license in \
  node.txt \
  postgresql.txt \
  pgvector.txt \
  valkey.txt
do
  if [[ ! -s "$LICENSES/$license" ]]; then
    echo "[Vendor] Required runtime license is missing: $LICENSES/$license" >&2
    exit 1
  fi
done

#
# Vendor manifest.
#
cat > "$VENDOR/vendor-manifest.json" <<JSON
{
  "schemaVersion": 1,
  "target": "$TARGET",
  "node": "$NODE_VERSION",
  "postgresql": "$POSTGRES_VERSION",
  "pgvector": "$PGVECTOR_VERSION",
  "pgvectorCommit": "$PGVECTOR_COMMIT",
  "cacheProvider": "Valkey",
  "cacheVersion": "$VALKEY_VERSION"
}
JSON

#
# Native runtime smoke verification.
#
"$RUNTIME/node/bin/node" --version
RUNTIME_NODE_PATH="$RUNTIME/node/bin${PATH:+:$PATH}"
env PATH="$RUNTIME_NODE_PATH" "$RUNTIME/node/bin/npm" --version
env PATH="$RUNTIME_NODE_PATH" "$RUNTIME/node/bin/npx" --version
env PATH="$RUNTIME_NODE_PATH" "$RUNTIME/node/bin/corepack" --version
"$RUNTIME/postgres/bin/postgres" --version
"$RUNTIME/redis/redis-server" --version

echo "[Vendor] Verified macOS runtime vendor payload: $VENDOR"