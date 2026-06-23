# Changelog

## [0.6.3](https://github.com/AsuraAce/ambit/compare/v0.6.2...v0.6.3) (2026-06-23)


### Bug Fixes

* correct resource asset inventory ([#146](https://github.com/AsuraAce/ambit/issues/146)) ([8521e7a](https://github.com/AsuraAce/ambit/commit/8521e7a9ac1d5ecabf68d0fd1a6dbcf07b9687f5))

## [0.6.2](https://github.com/AsuraAce/ambit/compare/v0.6.1...v0.6.2) (2026-06-20)


### Bug Fixes

* refresh canonical resource facets after reparse ([#144](https://github.com/AsuraAce/ambit/issues/144)) ([bb4987a](https://github.com/AsuraAce/ambit/commit/bb4987aa59173681f8c372e4842563d2707e89bb))

## [0.6.1](https://github.com/AsuraAce/ambit/compare/v0.6.0...v0.6.1) (2026-06-17)


### Bug Fixes

* clarify startup background activity ([#143](https://github.com/AsuraAce/ambit/issues/143)) ([fe8a95c](https://github.com/AsuraAce/ambit/commit/fe8a95cd49d2c1d05c66d1d72cb3905edbcb1b40))
* preserve truthful nullable seed metadata ([#141](https://github.com/AsuraAce/ambit/issues/141)) ([50819d4](https://github.com/AsuraAce/ambit/commit/50819d4b38bb4e3c8ff002743d1b470235d1e00b))

## [0.6.0](https://github.com/AsuraAce/ambit/compare/v0.5.0...v0.6.0) (2026-06-12)


### Features

* improve image viewer like and pin feedback ([#113](https://github.com/AsuraAce/ambit/issues/113)) ([2d7d0cd](https://github.com/AsuraAce/ambit/commit/2d7d0cd5ff5a80a30fe526b1b6c139106ed1c091))
* persist dynamic collection thumbnails ([#103](https://github.com/AsuraAce/ambit/issues/103)) ([31a3bff](https://github.com/AsuraAce/ambit/commit/31a3bfffbbab9f778ed7e9ef4d4c8f780b02512f))
* persist gallery layout mode ([#114](https://github.com/AsuraAce/ambit/issues/114)) ([4eddb72](https://github.com/AsuraAce/ambit/commit/4eddb72753adb174e7af1a9f051a94350459c306))
* **settings:** harden production and maintenance surfaces ([#128](https://github.com/AsuraAce/ambit/issues/128)) ([9396371](https://github.com/AsuraAce/ambit/commit/9396371f1a23212a3eed6ca79e505f1993c52a2e))


### Bug Fixes

* clean up resource asset discovery ([#133](https://github.com/AsuraAce/ambit/issues/133)) ([b447164](https://github.com/AsuraAce/ambit/commit/b4471646bf38a52ed855af8c79dc0c2b1a91061c))
* correct match any facet drilldown ([#127](https://github.com/AsuraAce/ambit/issues/127)) ([f361763](https://github.com/AsuraAce/ambit/commit/f3617639cf753e6362e6f377f041b59f4b1f2d1f))
* correct statistics queries and progressive loading ([#107](https://github.com/AsuraAce/ambit/issues/107)) ([68ffd72](https://github.com/AsuraAce/ambit/commit/68ffd7256b424819adca1919590fa96ce878d673))
* **deps:** block keyring major dependabot upgrades ([#95](https://github.com/AsuraAce/ambit/issues/95)) ([7510804](https://github.com/AsuraAce/ambit/commit/75108042703faaf5ab7da58b484d221fc3ecf08c))
* harden idle background work cleanup ([#121](https://github.com/AsuraAce/ambit/issues/121)) ([d1fdf17](https://github.com/AsuraAce/ambit/commit/d1fdf172d6d23119a1db7f41b7d12ccc79e2efdc))
* prefer nsis updater releases ([#61](https://github.com/AsuraAce/ambit/issues/61)) ([af82669](https://github.com/AsuraAce/ambit/commit/af8266944a5fa7bfaaef53a0a671bea636141d40))
* preserve optimistic pin cache ordering ([#115](https://github.com/AsuraAce/ambit/issues/115)) ([3941ec4](https://github.com/AsuraAce/ambit/commit/3941ec498c0031a0dd3158c69d608466d1313aa3))
* prevent stale collection refresh overwrites ([#75](https://github.com/AsuraAce/ambit/issues/75)) ([a009fe9](https://github.com/AsuraAce/ambit/commit/a009fe97fa5d1574a795f547e33b90becf65b5bb))
* remove ai studio project links ([#104](https://github.com/AsuraAce/ambit/issues/104)) ([bb8e2e7](https://github.com/AsuraAce/ambit/commit/bb8e2e752e37352c441c97f415ba114062979741))
* repair InvokeAI nested image paths ([#111](https://github.com/AsuraAce/ambit/issues/111)) ([3e79241](https://github.com/AsuraAce/ambit/commit/3e792419a055bb437d0a11fbd55718df617ceab2))
* replace readme banner asset ([#105](https://github.com/AsuraAce/ambit/issues/105)) ([93b0ab2](https://github.com/AsuraAce/ambit/commit/93b0ab27436edba9b0c50f1014dfd737f84806e2))
* restore production app build with Tailwind v4 ([#123](https://github.com/AsuraAce/ambit/issues/123)) ([b43cb2e](https://github.com/AsuraAce/ambit/commit/b43cb2e1199e31b319670cd05b4d53881bfe5aa7))
* restore Tailwind v4 default utilities ([#124](https://github.com/AsuraAce/ambit/issues/124)) ([7f4331d](https://github.com/AsuraAce/ambit/commit/7f4331d1343387622064737e2582d81c82f035e0))
* simplify support modal copy ([#102](https://github.com/AsuraAce/ambit/issues/102)) ([9db16bc](https://github.com/AsuraAce/ambit/commit/9db16bcc3aa283ee04b954b076b374286e7e413f))
* speed collection thumbnail startup ([#112](https://github.com/AsuraAce/ambit/issues/112)) ([73d8f55](https://github.com/AsuraAce/ambit/commit/73d8f556cafef3fe1e9b85ac06d3edb352ef3c28))
* stabilize integration import cancellation ([#60](https://github.com/AsuraAce/ambit/issues/60)) ([6485503](https://github.com/AsuraAce/ambit/commit/64855036bfba2cbff7a95e52f4a1a66d36b88d4a))
* stabilize live watch sync feedback ([#122](https://github.com/AsuraAce/ambit/issues/122)) ([ec2c84b](https://github.com/AsuraAce/ambit/commit/ec2c84bcc5ec28f4ca450bc68989c4422d06dc83))
* **timeline:** open clicked image after pin reordering ([#116](https://github.com/AsuraAce/ambit/issues/116)) ([e10f911](https://github.com/AsuraAce/ambit/commit/e10f911c2008f3fb2c65f97b262b3f25c4c2b11e))

## [0.5.0](https://github.com/AsuraAce/ambit/compare/v0.4.0...v0.5.0) (2026-05-14)


### Features

* add backend smart thumbnail optimizer ([#46](https://github.com/AsuraAce/ambit/issues/46)) ([47c9b21](https://github.com/AsuraAce/ambit/commit/47c9b21146eb40a75e1720cac00c94599f686b5e))
* add collection thumbnail hydration feedback ([#49](https://github.com/AsuraAce/ambit/issues/49)) ([e08086b](https://github.com/AsuraAce/ambit/commit/e08086bbf732624325a4a622de10d5712a866877))
* add cursor-anchored viewer zoom ([#43](https://github.com/AsuraAce/ambit/issues/43)) ([1c69e05](https://github.com/AsuraAce/ambit/commit/1c69e05a2b7af9a30074c25b5ff05894b5170ecb))
* highlight search terms in viewer ([#32](https://github.com/AsuraAce/ambit/issues/32)) ([bc44fda](https://github.com/AsuraAce/ambit/commit/bc44fdaa9d68d38550d8ce620db38a7f7b2f5e6e))


### Bug Fixes

* clean up startup logs and refreshes ([#40](https://github.com/AsuraAce/ambit/issues/40)) ([9442f2d](https://github.com/AsuraAce/ambit/commit/9442f2d1e905632a06f200b8f8d04fdb801c5b06))
* harden beta security surfaces ([#54](https://github.com/AsuraAce/ambit/issues/54)) ([981c13f](https://github.com/AsuraAce/ambit/commit/981c13fee497aea42c0d33186def077d01f68111))
* harden monitored folder catch-up imports ([#36](https://github.com/AsuraAce/ambit/issues/36)) ([325014b](https://github.com/AsuraAce/ambit/commit/325014b676d1289235af3eea2698f0b87c375479))
* harden os open path provenance ([#55](https://github.com/AsuraAce/ambit/issues/55)) ([0603d6b](https://github.com/AsuraAce/ambit/commit/0603d6bf25342003bc58f5a6f9d474ca0ece2f82))
* improve a1111 folder discovery ([#50](https://github.com/AsuraAce/ambit/issues/50)) ([55528ed](https://github.com/AsuraAce/ambit/commit/55528ed4cef1d95a3085cc722595856f381b7240))
* load older timeline results ([#42](https://github.com/AsuraAce/ambit/issues/42)) ([5d480fe](https://github.com/AsuraAce/ambit/commit/5d480fe5b07d2ef3786f35331d6ba09de6312a43))
* make tauri build non-interactive ([#29](https://github.com/AsuraAce/ambit/issues/29)) ([f0a4422](https://github.com/AsuraAce/ambit/commit/f0a44223f93bd474a366cf693bf273295905cc6e))
* make tauri build non-interactive ([#30](https://github.com/AsuraAce/ambit/issues/30)) ([7785692](https://github.com/AsuraAce/ambit/commit/778569243dc7fbab7c29db1e38b17818a8b195e1))
* repair hash resolution flow ([#41](https://github.com/AsuraAce/ambit/issues/41)) ([e9e4e81](https://github.com/AsuraAce/ambit/commit/e9e4e8168c3f227fd56625ba93a7088d2124c9bb))


### Performance Improvements

* incrementally refresh startup facets ([#39](https://github.com/AsuraAce/ambit/issues/39)) ([5cf3b58](https://github.com/AsuraAce/ambit/commit/5cf3b589c421e7b6c9b30621fc30c6d9e418777c))
* reduce gallery resource usage ([#28](https://github.com/AsuraAce/ambit/issues/28)) ([52d6646](https://github.com/AsuraAce/ambit/commit/52d6646f54353205ab13c21de6875229a1a6f765))

## [0.4.0](https://github.com/AsuraAce/ambit/compare/v0.3.0...v0.4.0) (2026-04-27)


### Features

* add auto-update flow and fix release image loading ([#10](https://github.com/AsuraAce/ambit/issues/10)) ([6ccaa8a](https://github.com/AsuraAce/ambit/commit/6ccaa8a70b1edb839a91cd5dbecad969884446d1))
* add app branding ([#13](https://github.com/AsuraAce/ambit/issues/13)) ([b410603](https://github.com/AsuraAce/ambit/commit/b410603ac7dfd5fb0f5a86eb9f3e03dda62aa61a))
* add browser mock mode ([#16](https://github.com/AsuraAce/ambit/issues/16)) ([7efdf74](https://github.com/AsuraAce/ambit/commit/7efdf741637df0303f5c8fc9f94348e9257fe55f))
* wire support funding links ([#14](https://github.com/AsuraAce/ambit/issues/14)) ([56d4ff5](https://github.com/AsuraAce/ambit/commit/56d4ff5887af72f731448b4902d69526f748e68e))


### Bug Fixes

* adjust database backup defaults ([#20](https://github.com/AsuraAce/ambit/issues/20)) ([79b5c8e](https://github.com/AsuraAce/ambit/commit/79b5c8ef1c7bc3dfc8aa2ad7d50418ca25784ba1))
* fix prod database startup and search performance ([#21](https://github.com/AsuraAce/ambit/issues/21)) ([1fd5ffc](https://github.com/AsuraAce/ambit/commit/1fd5ffc7bb2f0db0da44b0341619d227e34680a3))
* fix Live Watch sync coordination and stabilize the Live Watch card ([#12](https://github.com/AsuraAce/ambit/issues/12)) ([d025822](https://github.com/AsuraAce/ambit/commit/d02582221ab643c3510e54aeaf0bac6821dc481f))
* publish Windows releases only ([#15](https://github.com/AsuraAce/ambit/issues/15)) ([2241547](https://github.com/AsuraAce/ambit/commit/22415473a182e14a4b189a1060eb52900609dd6d))
* release prep library removal and reliability fixes ([#19](https://github.com/AsuraAce/ambit/issues/19)) ([1b5174a](https://github.com/AsuraAce/ambit/commit/1b5174ad8563bab9014de5b3ed27b899637600ef))
* show image skeletons during placeholder queries ([#22](https://github.com/AsuraAce/ambit/issues/22)) ([7f3f088](https://github.com/AsuraAce/ambit/commit/7f3f088b2a1f1a42da5dca8dcfbf3348cbfa3c1f))
* simplify startup loader ([#17](https://github.com/AsuraAce/ambit/issues/17)) ([f21305c](https://github.com/AsuraAce/ambit/commit/f21305c69eb37ed2edac31f9e9f36da6b2732880))

## [0.3.0](https://github.com/AsuraAce/ambit/compare/v0.2.0...v0.3.0) (2026-04-16)


### Features

* **filters:** use typed valid-facet inputs ([#7](https://github.com/AsuraAce/ambit/issues/7)) ([4f56462](https://github.com/AsuraAce/ambit/commit/4f56462226c3e20617cabc40c200cec4f8f253e0))

## [0.2.0](https://github.com/AsuraAce/ambit/compare/v0.1.0...v0.2.0) (2026-04-16)


### Features

* add Gemini CLI automation commands and hooks ([bbacc17](https://github.com/AsuraAce/ambit/commit/bbacc178ffe1c5ebb472f855bb53a9fa7ae4ada5))


### Bug Fixes

* **ci:** add PR checks and stabilize release workflows ([#6](https://github.com/AsuraAce/ambit/issues/6)) ([35b2d0a](https://github.com/AsuraAce/ambit/commit/35b2d0a59782fc13125e067438bd06a89d4fe72d))
* **ui:** resolve production titlebar retraction and collection flickering issues ([d787996](https://github.com/AsuraAce/ambit/commit/d787996b98fb43ada91eab407652095c31fa418b))
