# 正式发布配置

发布工作流在 `v*` 标签或手动触发时构建 Windows NSIS 与 macOS DMG，并生成 Tauri v2 自动更新签名和 `latest.json`。发布默认保持为 GitHub Draft，验收后再公开。

## 一次性准备

生成更新签名密钥，私钥必须离开仓库安全备份；公钥可以公开：

```bash
npm run tauri signer generate -- -w /安全路径/photo-wall-updater.key
```

在 GitHub Actions 配置这些 Secrets：

- `TAURI_UPDATER_PRIVATE_KEY`、`TAURI_UPDATER_PRIVATE_KEY_PASSWORD`、`TAURI_UPDATER_PUBLIC_KEY`
- Windows：`WINDOWS_CERTIFICATE`（PFX 的 Base64）、`WINDOWS_CERTIFICATE_PASSWORD`
- macOS：`APPLE_CERTIFICATE`（Developer ID Application P12 的 Base64）、`APPLE_CERTIFICATE_PASSWORD`、`KEYCHAIN_PASSWORD`
- macOS 公证：`APPLE_API_ISSUER`、`APPLE_API_KEY`、`APPLE_API_PRIVATE_KEY`（p8 的 Base64）

可选 Repository Variable `WINDOWS_TIMESTAMP_URL`；缺省使用 DigiCert 时间戳服务。2023 年 6 月以后签发、私钥位于硬件或云 HSM 的 Windows 证书通常不能导出为 PFX，应按证书服务商要求将工作流改为 Tauri `signCommand`。

## 发布

1. 同步 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 的版本号。
2. 在主分支完整执行 `npm test`、`npm run build` 和 `npm run test:e2e`。
3. 创建并推送标签，例如 `git tag v1.1.0 && git push origin v1.1.0`。
4. 在 Draft Release 中验证 Windows 签名、macOS `codesign`/公证票据以及更新包 `.sig`，再公开发布。

本地普通构建不会启用更新端点，也不会要求发布密钥。`src-tauri/tauri.release.conf.example.json` 只说明配置结构，不能直接用于生产发布。
