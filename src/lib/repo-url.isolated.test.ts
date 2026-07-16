import { describe, expect, test } from 'bun:test';
import { isRepoUrl, parseRepoUrl } from './repo-url.ts';

describe('parseRepoUrl', () => {
	test('parses https URLs with and without .git', () => {
		for (const url of [
			'https://github.com/octocat/Hello-World',
			'https://github.com/octocat/Hello-World.git',
			'https://github.com/octocat/Hello-World/',
			'http://github.com/octocat/Hello-World'
		]) {
			expect(parseRepoUrl(url)).toEqual({
				host: 'github.com',
				owner: 'octocat',
				repo: 'Hello-World',
				cloneUrl: 'https://github.com/octocat/Hello-World.git'
			});
		}
	});

	test('parses scp-like and ssh URLs', () => {
		expect(parseRepoUrl('git@github.com:octocat/Hello-World.git')?.cloneUrl).toBe(
			'https://github.com/octocat/Hello-World.git'
		);
		expect(parseRepoUrl('ssh://git@github.com/octocat/Hello-World')?.cloneUrl).toBe(
			'https://github.com/octocat/Hello-World.git'
		);
	});

	test('parses schemeless host/owner/repo', () => {
		expect(parseRepoUrl('github.com/octocat/Hello-World')?.owner).toBe('octocat');
	});

	test('ignores extra path segments (tree/branch)', () => {
		expect(parseRepoUrl('https://github.com/octocat/Hello-World/tree/main')?.repo).toBe(
			'Hello-World'
		);
	});

	test('supports non-github hosts', () => {
		expect(parseRepoUrl('https://gitlab.com/group/project.git')).toEqual({
			host: 'gitlab.com',
			owner: 'group',
			repo: 'project',
			cloneUrl: 'https://gitlab.com/group/project.git'
		});
	});

	test('rejects local paths and non-repo strings', () => {
		for (const bad of [
			'/Users/k/Documents/GitHub/devcontainers-manager',
			'/tmp/some/folder',
			'~/code/project',
			'./relative/path',
			'just-a-name',
			'',
			'   ',
			'https://github.com/onlyowner'
		]) {
			expect(parseRepoUrl(bad)).toBeNull();
			expect(isRepoUrl(bad)).toBe(false);
		}
	});
});
