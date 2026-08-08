# Changelog

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
