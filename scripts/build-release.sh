#!/usr/bin/env bash
set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly PROJECT_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
readonly USER_HOME="${HOME:?HOME is not set}"

readonly CARGO_BIN_DIR="${USER_HOME}/.cargo/bin"
readonly TAURI_CROSS_ROOT="${USER_HOME}/.local/tauri-cross"
readonly LOCAL_JAVA_HOME="${PHOTO_WALL_JAVA_HOME:-${USER_HOME}/.local/jdk17-root/usr/lib/jvm/java-17-openjdk-amd64}"
readonly LOCAL_ANDROID_SDK="${PHOTO_WALL_ANDROID_SDK:-${USER_HOME}/android-sdk}"
readonly LOCAL_NDK_HOME="${PHOTO_WALL_NDK_HOME:-${LOCAL_ANDROID_SDK}/ndk/27.2.12479018}"
readonly LOCAL_XWIN_CACHE="${PHOTO_WALL_XWIN_CACHE:-${USER_HOME}/.cache/xwin}"
readonly LOCAL_KEYSTORE="${PHOTO_WALL_KEYSTORE:-${USER_HOME}/.local/share/photo-wall/photo-wall-local.jks}"
readonly KEYSTORE_ALIAS="photo-wall-local"
readonly KEYSTORE_PASSWORD="android"

log() {
  printf '\n==> %s\n' "$1"
}

die() {
  printf '错误：%s\n' "$1" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "缺少命令：$1"
}

require_executable() {
  [[ -x "$1" ]] || die "缺少可执行文件：$1"
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<'EOF'
用法：./scripts/build-release.sh

重新生成以下正式交付文件：
  releases/Photo-Wall_<版本>_x64-setup.exe
  releases/Photo-Wall_<版本>_arm64.apk

可选环境变量：
  PHOTO_WALL_JAVA_HOME    JDK 17 路径
  PHOTO_WALL_ANDROID_SDK  Android SDK 路径
  PHOTO_WALL_NDK_HOME     Android NDK 路径
  PHOTO_WALL_XWIN_CACHE   cargo-xwin 缓存路径
  PHOTO_WALL_KEYSTORE     本地 APK 签名证书路径
EOF
  exit 0
fi

[[ $# -eq 0 ]] || die "未知参数：$1（使用 --help 查看帮助）"

cd "$PROJECT_ROOT"

require_command node
require_command npm
require_executable "${CARGO_BIN_DIR}/cargo"
require_executable "${CARGO_BIN_DIR}/cargo-xwin"
require_executable "${CARGO_BIN_DIR}/rustup"
require_executable "${LOCAL_JAVA_HOME}/bin/java"
require_executable "${LOCAL_JAVA_HOME}/bin/keytool"
require_executable "${TAURI_CROSS_ROOT}/bin/makensis"
require_executable "${TAURI_CROSS_ROOT}/usr/lib/llvm-14/bin/clang-cl"
[[ -d "$LOCAL_ANDROID_SDK" ]] || die "找不到 Android SDK：${LOCAL_ANDROID_SDK}"
[[ -d "$LOCAL_NDK_HOME" ]] || die "找不到 Android NDK：${LOCAL_NDK_HOME}"

export JAVA_HOME="$LOCAL_JAVA_HOME"
export ANDROID_HOME="$LOCAL_ANDROID_SDK"
export ANDROID_SDK_ROOT="$LOCAL_ANDROID_SDK"
export NDK_HOME="$LOCAL_NDK_HOME"
export XWIN_CACHE_DIR="$LOCAL_XWIN_CACHE"
export NSISDIR="${TAURI_CROSS_ROOT}/usr/share/nsis"
export LD_LIBRARY_PATH="${TAURI_CROSS_ROOT}/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"
export PATH="${CARGO_BIN_DIR}:${TAURI_CROSS_ROOT}/bin:${TAURI_CROSS_ROOT}/usr/bin:${TAURI_CROSS_ROOT}/usr/lib/llvm-14/bin:${LOCAL_ANDROID_SDK}/platform-tools:${LOCAL_ANDROID_SDK}/cmdline-tools/latest/bin:${LOCAL_JAVA_HOME}/bin:${PATH}"

readonly APP_VERSION="$(node -p "require('./package.json').version")"
[[ "$APP_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-.+][0-9A-Za-z.-]+)?$ ]] || die "无法识别应用版本：${APP_VERSION}"

readonly RELEASE_DIR="${PROJECT_ROOT}/releases"
readonly WINDOWS_OUTPUT="${RELEASE_DIR}/Photo-Wall_${APP_VERSION}_x64-setup.exe"
readonly ANDROID_OUTPUT="${RELEASE_DIR}/Photo-Wall_${APP_VERSION}_arm64.apk"
readonly ANDROID_PROJECT="${PROJECT_ROOT}/src-tauri/gen/android"
readonly WINDOWS_BUNDLE_DIR="${PROJECT_ROOT}/src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis"
readonly BUILD_TEMP_DIR="$(mktemp -d /tmp/photo-wall-release.XXXXXX)"
readonly GENERATED_ICON_DIR="${BUILD_TEMP_DIR}/icons"

cleanup() {
  if [[ -n "${BUILD_TEMP_DIR:-}" && -d "$BUILD_TEMP_DIR" ]]; then
    rm -rf -- "$BUILD_TEMP_DIR"
  fi
}
trap cleanup EXIT

mkdir -p "$RELEASE_DIR"

BUILD_TOOLS_VERSION="$(find "${LOCAL_ANDROID_SDK}/build-tools" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort -V | tail -n 1)"
[[ -n "$BUILD_TOOLS_VERSION" ]] || die "Android build-tools 未安装"
readonly BUILD_TOOLS_DIR="${LOCAL_ANDROID_SDK}/build-tools/${BUILD_TOOLS_VERSION}"
require_executable "${BUILD_TOOLS_DIR}/zipalign"
require_executable "${BUILD_TOOLS_DIR}/apksigner"

if ! "${CARGO_BIN_DIR}/rustup" target list --installed | grep -qx 'x86_64-pc-windows-msvc'; then
  die "Rust target x86_64-pc-windows-msvc 未安装"
fi
if ! "${CARGO_BIN_DIR}/rustup" target list --installed | grep -qx 'aarch64-linux-android'; then
  die "Rust target aarch64-linux-android 未安装"
fi

log "生成所有平台图标"
npm run tauri -- icon --output "$GENERATED_ICON_DIR" assets/app-icon-manifest.json
mkdir -p src-tauri/icons
cp -a "${GENERATED_ICON_DIR}/." src-tauri/icons/

if [[ ! -x "${ANDROID_PROJECT}/gradlew" ]]; then
  log "初始化 Android 工程"
  npm run tauri -- android init --ci --skip-targets-install
fi

log "同步 Android 启动图标"
mkdir -p "${ANDROID_PROJECT}/app/src/main/res"
cp -a src-tauri/icons/android/. "${ANDROID_PROJECT}/app/src/main/res/"

log "构建 Windows x64 NSIS 安装程序"
npm run tauri -- build --runner cargo-xwin --target x86_64-pc-windows-msvc

WINDOWS_BUNDLE="$(find "$WINDOWS_BUNDLE_DIR" -maxdepth 1 -type f -name '*_x64-setup.exe' -printf '%T@ %p\n' | sort -nr | head -n 1 | cut -d' ' -f2-)"
[[ -n "$WINDOWS_BUNDLE" && -f "$WINDOWS_BUNDLE" ]] || die "未找到 Windows NSIS 安装程序"
cp -p "$WINDOWS_BUNDLE" "$WINDOWS_OUTPUT"

log "构建 Android ARM64 release APK"
npm run tauri -- android build --apk --target aarch64 --ci

readonly UNSIGNED_APK="${ANDROID_PROJECT}/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk"
[[ -f "$UNSIGNED_APK" ]] || die "未找到 Android unsigned APK：${UNSIGNED_APK}"

if [[ ! -f "$LOCAL_KEYSTORE" ]]; then
  log "创建本地 Android 开发签名证书"
  mkdir -p "$(dirname -- "$LOCAL_KEYSTORE")"
  "${LOCAL_JAVA_HOME}/bin/keytool" \
    -genkeypair \
    -keystore "$LOCAL_KEYSTORE" \
    -storetype PKCS12 \
    -alias "$KEYSTORE_ALIAS" \
    -keyalg RSA \
    -keysize 2048 \
    -validity 36500 \
    -dname 'CN=Photo Wall Local Development,O=Photo Wall,C=CN' \
    -storepass "$KEYSTORE_PASSWORD" \
    -keypass "$KEYSTORE_PASSWORD"
fi

readonly ALIGNED_APK="${BUILD_TEMP_DIR}/Photo-Wall_${APP_VERSION}_arm64-aligned.apk"
readonly SIGNED_APK="${BUILD_TEMP_DIR}/Photo-Wall_${APP_VERSION}_arm64.apk"

log "对齐并签名 Android APK"
"${BUILD_TOOLS_DIR}/zipalign" -f -p 4 "$UNSIGNED_APK" "$ALIGNED_APK"
"${BUILD_TOOLS_DIR}/apksigner" sign \
  --ks "$LOCAL_KEYSTORE" \
  --ks-key-alias "$KEYSTORE_ALIAS" \
  --ks-pass "pass:${KEYSTORE_PASSWORD}" \
  --key-pass "pass:${KEYSTORE_PASSWORD}" \
  --v4-signing-enabled false \
  --out "$SIGNED_APK" \
  "$ALIGNED_APK"
"${BUILD_TOOLS_DIR}/apksigner" verify --verbose "$SIGNED_APK"
"${BUILD_TOOLS_DIR}/zipalign" -c 4 "$SIGNED_APK"
mv -f "$SIGNED_APK" "$ANDROID_OUTPUT"

log "发布文件生成完成"
ls -lh "$WINDOWS_OUTPUT" "$ANDROID_OUTPUT"
sha256sum "$WINDOWS_OUTPUT" "$ANDROID_OUTPUT"
