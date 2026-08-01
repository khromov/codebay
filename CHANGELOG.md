# Changelog

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
