# Changelog

## [0.12.0](https://github.com/khromov/codebay/compare/codebay-v0.11.1...codebay-v0.12.0) (2026-08-14)


### Features

* make tab keyboard shortcuts toggleable in settings ([#149](https://github.com/khromov/codebay/issues/149)) ([f0579f3](https://github.com/khromov/codebay/commit/f0579f36ba524ae4d6880515539cf77c30ffac1e))


### Performance Improvements

* render the grid overlay on a fixed layer and cut moiré ([#147](https://github.com/khromov/codebay/issues/147)) ([c0c64b0](https://github.com/khromov/codebay/commit/c0c64b051e02a7d15f21ec038aac78cd37a62647))

## [0.11.1](https://github.com/khromov/codebay/compare/codebay-v0.11.0...codebay-v0.11.1) (2026-08-14)


### Bug Fixes

* boot the Codebay-owned config via --override-config ([#145](https://github.com/khromov/codebay/issues/145)) ([934516e](https://github.com/khromov/codebay/commit/934516e730894d62041c9e1ae0ac9bbcbfe58671))

## [0.11.0](https://github.com/khromov/codebay/compare/codebay-v0.10.1...codebay-v0.11.0) (2026-08-14)


### Features

* redesign the IDE instance tabs ([#141](https://github.com/khromov/codebay/issues/141)) ([becb743](https://github.com/khromov/codebay/commit/becb74328152fd2f5a61c4970c82bfa0e986cd29))
* warm amber CRT dark mode ([#142](https://github.com/khromov/codebay/issues/142)) ([9032f8b](https://github.com/khromov/codebay/commit/9032f8b16b83b88fce76183bb4760912731a50d7))


### Bug Fixes

* keep the project's devcontainer.json pristine in instance copies ([#137](https://github.com/khromov/codebay/issues/137)) ([ea6b931](https://github.com/khromov/codebay/commit/ea6b9317bb705a54ed904a3f4de86e6b52057894))

## [0.10.1](https://github.com/khromov/codebay/compare/codebay-v0.10.0...codebay-v0.10.1) (2026-08-13)


### Bug Fixes

* stop the terminal launching claude before injections finish ([#139](https://github.com/khromov/codebay/issues/139)) ([3638389](https://github.com/khromov/codebay/commit/3638389f3ad8a01b816256c69bdd57ee7422fd3b))

## [0.10.0](https://github.com/khromov/codebay/compare/codebay-v0.9.1...codebay-v0.10.0) (2026-08-11)


### Features

* claude permission mode setting, terminal-mode env fix, mode shortcut ([#122](https://github.com/khromov/codebay/issues/122)) ([f5c39c9](https://github.com/khromov/codebay/commit/f5c39c9fde9a79356814f3189c8c840723cecd20))
* continuously extract Claude Code logs to &lt;DATA_DIR&gt;/logs ([#136](https://github.com/khromov/codebay/issues/136)) ([954ad68](https://github.com/khromov/codebay/commit/954ad68b4eec067e30be65d966437cb1af4c17e1))
* default Claude Code effort level setting ([#132](https://github.com/khromov/codebay/issues/132)) ([cdef824](https://github.com/khromov/codebay/commit/cdef82401ee0f67fa6cfcf0317f135701ba929eb))
* inject custom environment variables (secrets) into all containers ([#135](https://github.com/khromov/codebay/issues/135)) ([71cb47b](https://github.com/khromov/codebay/commit/71cb47b5c7ff6f179fbebc32e1d18e26f8dadf1b))


### Bug Fixes

* allow manual vscode reload ([1b33d2e](https://github.com/khromov/codebay/commit/1b33d2ea3a50b77e10010a424f25f1f3c60bb6d4))
* guarantee unique instance avatars ([#134](https://github.com/khromov/codebay/issues/134)) ([ecc588d](https://github.com/khromov/codebay/commit/ecc588dc5551012e42ca771a2c2e1f08b56f9f18))
* keep the boot-log Follow toggle from turning itself off ([#133](https://github.com/khromov/codebay/issues/133)) ([223b723](https://github.com/khromov/codebay/commit/223b72359a6869fc4e1424e159e03efa06529b0c))
* relaunch the terminal when a stopped instance is started again ([#130](https://github.com/khromov/codebay/issues/130)) ([8575e69](https://github.com/khromov/codebay/commit/8575e69c19be8796c2e71bdab3ce94e4f7dcad13))
* stop stranding instances on host ports taken over outside Docker ([#131](https://github.com/khromov/codebay/issues/131)) ([84fb0f8](https://github.com/khromov/codebay/commit/84fb0f88774eabbaa14fce500876a025bf937813))


### Performance Improvements

* cut instance boot latency (background extension install, eager health, staged parallel injections) ([#125](https://github.com/khromov/codebay/issues/125)) ([94ee732](https://github.com/khromov/codebay/commit/94ee732936fefb847ddb6edb39cb7631f88a6f07))

## [0.9.1](https://github.com/khromov/codebay/compare/codebay-v0.9.0...codebay-v0.9.1) (2026-08-10)


### Bug Fixes

* stop terminal mode installing Node via nvm into project images ([#126](https://github.com/khromov/codebay/issues/126)) ([dc7e749](https://github.com/khromov/codebay/commit/dc7e7498057b2e36c17b96752b6be73174614de0))


### Reverts

* drop connect-first WebSocket subprotocol relay (standby) ([#121](https://github.com/khromov/codebay/issues/121)) ([e01b8dd](https://github.com/khromov/codebay/commit/e01b8dd984d037198748c3d6967801651168bd5f))

## [0.9.0](https://github.com/khromov/codebay/compare/codebay-v0.8.0...codebay-v0.9.0) (2026-08-09)


### Features

* edit robot-generated avatars from the editor UI ([#116](https://github.com/khromov/codebay/issues/116)) ([b32640e](https://github.com/khromov/codebay/commit/b32640ea32c12f4c31b95b5b4601a90d93320ae1))
* lightweight terminal-only instance mode ([#119](https://github.com/khromov/codebay/issues/119)) ([11da86c](https://github.com/khromov/codebay/commit/11da86ce68459bd613c9396cad9216d5f1cca14b))
* persist the dashboard instance filter across tabs, reloads, and clients ([#117](https://github.com/khromov/codebay/issues/117)) ([ac98889](https://github.com/khromov/codebay/commit/ac9888940a01fee9e239fbb12b347f42ea4ed529))


### Bug Fixes

* show avatar name in avatar tooltip ([#112](https://github.com/khromov/codebay/issues/112)) ([06d7c9a](https://github.com/khromov/codebay/commit/06d7c9a15e049056dcd46749a6fecdf9ef326567))

## [0.8.0](https://github.com/khromov/codebay/compare/codebay-v0.7.0...codebay-v0.8.0) (2026-08-08)


### Features

* keep Claude Code up to date in containers on every boot ([#107](https://github.com/khromov/codebay/issues/107)) ([dce6344](https://github.com/khromov/codebay/commit/dce634456027b0451f70d4b00d186d7b4287332e))


### Bug Fixes

* **ci:** publish versioned + :latest Docker images; log version at startup ([#110](https://github.com/khromov/codebay/issues/110)) ([678e173](https://github.com/khromov/codebay/commit/678e173dcd50f779b3f12c13ce5e92fa985bf900))
* stop zsh unmatched-glob spam while waiting for the IDE bridge lock ([#111](https://github.com/khromov/codebay/issues/111)) ([59f3e1d](https://github.com/khromov/codebay/commit/59f3e1d48888ed48b9fe43469a002f5f266f1aa7))

## [0.7.0](https://github.com/khromov/codebay/compare/codebay-v0.6.0...codebay-v0.7.0) (2026-08-05)


### Features

* add instance view filter (All | Active | Stopped) to dashboard ([#104](https://github.com/khromov/codebay/issues/104)) ([d810314](https://github.com/khromov/codebay/commit/d8103148a2a0e88610e80c57f99c6d4df1cade75))

## [0.6.0](https://github.com/khromov/codebay/compare/codebay-v0.5.0...codebay-v0.6.0) (2026-08-03)


### Features

* add minimal Bun devcontainer ([#87](https://github.com/khromov/codebay/issues/87)) ([87f53fa](https://github.com/khromov/codebay/commit/87f53fae3c2857597b4e388de3a027490f3729e3))
* auto-install Claude Code IDE extension in every instance ([#101](https://github.com/khromov/codebay/issues/101)) ([e04b697](https://github.com/khromov/codebay/commit/e04b697c198a5b290185d4b57f69938f126b0a04))
* flag original AI-generated avatars with robot marker ([#81](https://github.com/khromov/codebay/issues/81)) ([6c95530](https://github.com/khromov/codebay/commit/6c95530ae147d865fc041a439625c9f4257c3401))
* grayscale (third) pixel level for avatars ([#95](https://github.com/khromov/codebay/issues/95)) ([40cf324](https://github.com/khromov/codebay/commit/40cf3241db7e3562d833fecf91511ffc27fd8987))
* loading state for instance-card actions ([#102](https://github.com/khromov/codebay/issues/102)) ([d47a1ba](https://github.com/khromov/codebay/commit/d47a1ba44ff66c779bf09323bf1ebc8106766274))
* pre-accept Claude Code startup prompts in containers ([#89](https://github.com/khromov/codebay/issues/89)) ([67260cf](https://github.com/khromov/codebay/commit/67260cf7298e74dc9a861bcdd8769e92981c7a83))
* warn before leaving the SPA when instances are running ([#93](https://github.com/khromov/codebay/issues/93)) ([a0bfe5f](https://github.com/khromov/codebay/commit/a0bfe5f6eb72f131fbd9941d4273ab7c6b2bc53c))


### Bug Fixes

* add node feature so the devcontainer builds ([#92](https://github.com/khromov/codebay/issues/92)) ([40e0aba](https://github.com/khromov/codebay/commit/40e0aba599ba8a460af2c2699a2a341052426d16))
* auto-scroll boot log with a Follow toggle ([#96](https://github.com/khromov/codebay/issues/96)) ([fd0e414](https://github.com/khromov/codebay/commit/fd0e414a53eb1cfe27c02cc8705a62d37266c372))
* Claude trust pre-acceptance on claude ≥2.1.220 + injection/launch race ([#100](https://github.com/khromov/codebay/issues/100)) ([51cb671](https://github.com/khromov/codebay/commit/51cb67101b282a06cbc8141341098580da77edd1))
* force code-server to always render dark theme ([#103](https://github.com/khromov/codebay/issues/103)) ([dbee251](https://github.com/khromov/codebay/commit/dbee2519e199d33662c1482db849bf103050ac3e))
* wrap long instance names instead of truncating ([#99](https://github.com/khromov/codebay/issues/99)) ([2f9c705](https://github.com/khromov/codebay/commit/2f9c7054336f43e54c913f29f8ba2dfdb3a0e731))
* wrap long instance names instead of truncating ([#99](https://github.com/khromov/codebay/issues/99)) ([bb51bc4](https://github.com/khromov/codebay/commit/bb51bc4a1153b06467d075b0551a2e3533676c66))

## [0.5.0](https://github.com/khromov/codebay/compare/codebay-v0.4.0...codebay-v0.5.0) (2026-08-01)


### Features

* propagate host Claude model default and suppress attribution ([#73](https://github.com/khromov/codebay/issues/73)) ([6540675](https://github.com/khromov/codebay/commit/65406756354acb21ebb5cba000ca6067baaf05b0))


### Bug Fixes

* robust statusLine script detection (jq operators, ~/ paths) ([#70](https://github.com/khromov/codebay/issues/70)) ([8bc6ee3](https://github.com/khromov/codebay/commit/8bc6ee33fd5c2bcad181d2002e3745862924d9f5))

## [0.4.0](https://github.com/khromov/codebay/compare/codebay-v0.3.0...codebay-v0.4.0) (2026-08-01)


### Features

* allow overriding git identity in settings ([#64](https://github.com/khromov/codebay/issues/64)) ([0c63257](https://github.com/khromov/codebay/commit/0c632575cd461a8141d68148bb65fa63b3de050a))
* **settings:** let a pet sprite replace the header box logo ([#69](https://github.com/khromov/codebay/issues/69)) ([c0d3afd](https://github.com/khromov/codebay/commit/c0d3afd7a0b2f8a8206e4b695cf79cea3af6a82a))
* **settings:** manual Claude model override on the standard path ([#65](https://github.com/khromov/codebay/issues/65)) ([4cf1758](https://github.com/khromov/codebay/commit/4cf17585e55f1d0835766b4f91e87bd3ebb28722))

## [0.3.0](https://github.com/khromov/codebay/compare/codebay-v0.2.1...codebay-v0.3.0) (2026-07-30)

### Features

- **cli:** add --help and --version flags ([#61](https://github.com/khromov/codebay/issues/61)) ([ea431a4](https://github.com/khromov/codebay/commit/ea431a4799d779a061cbf3ea360095ff3d6ae737))

## [0.2.1](https://github.com/khromov/codebay/compare/codebay-v0.2.0...codebay-v0.2.1) (2026-07-30)

### Bug Fixes

- publish forwarded ports on HOST, show version, stabilize avatar hint ([#59](https://github.com/khromov/codebay/issues/59)) ([aa50799](https://github.com/khromov/codebay/commit/aa507994ab970d9af01c7e02dc3732aa0d8d52ba))

## [0.2.0](https://github.com/khromov/codebay/compare/codebay-v0.1.0...codebay-v0.2.0) (2026-07-29)

### Features

- **claude-code:** disable co-author byline on commits by default ([#57](https://github.com/khromov/codebay/issues/57)) ([f4e8377](https://github.com/khromov/codebay/commit/f4e8377a4e89ecf534ccf8f2a69daffddb4b53de))
- **dashboard:** add a rebuild action to the instance card ([#55](https://github.com/khromov/codebay/issues/55)) ([c524981](https://github.com/khromov/codebay/commit/c524981be49833f5f6f2ae696794131ee7fb7393))
- github checkout ([d0a01be](https://github.com/khromov/codebay/commit/d0a01be31a581aeadd07eaff7f4133b15575604e))
- prep release ([e4e3e17](https://github.com/khromov/codebay/commit/e4e3e1716d307608cd2d282714985cbb504a82ac))
- release ([#58](https://github.com/khromov/codebay/issues/58)) ([56257e6](https://github.com/khromov/codebay/commit/56257e65603db0f8ba1c0ae0515fb96c2bab848b))
- run codebay as a Docker (DooD) container + publish image to GHCR ([003b8c9](https://github.com/khromov/codebay/commit/003b8c9ef9bbbf505b22d85fd78e22c6d3f1dd49))
- run codebay as a Docker (DooD) container + publish to GHCR ([43361cb](https://github.com/khromov/codebay/commit/43361cb2fe7de7289311a1138dedf3203df5b457))

### Bug Fixes

- **claude-code:** inject usable tokens, and stop reporting signed-out containers as healthy ([#53](https://github.com/khromov/codebay/issues/53)) ([f3122f6](https://github.com/khromov/codebay/commit/f3122f6f7f87670ad36fab8a5e52b9471b357a6a))
- **ide:** make the IDE wait for code-server, and fail legibly when it never answers ([#54](https://github.com/khromov/codebay/issues/54)) ([9753fb0](https://github.com/khromov/codebay/commit/9753fb039cbfc0448e83377289529e6dd2481722))
