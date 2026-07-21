const assert = require('node:assert/strict');
const test = require('node:test');

const {
  REQUIRED_HEADINGS,
  validatePullRequest,
} = require('../scripts/check-pr-policy');

function buildBody({ issue = 65, checked = true, reason = '不适用' } = {}) {
  const sections = REQUIRED_HEADINGS.map((heading) => {
    if (heading === '关联 Issue') {
      return `## ${heading}\n\nCloses #${issue}`;
    }
    if (heading === 'PR 粒度说明') {
      return `## ${heading}\n\n- 如超过，为什么不能拆分：${reason}`;
    }
    if (heading === '检查清单') {
      const marker = checked ? 'x' : ' ';
      return `## ${heading}\n\n${Array.from(
        { length: 9 },
        (_, index) => `- [${marker}] 检查项 ${index + 1}`,
      ).join('\n')}`;
    }
    return `## ${heading}\n\n已填写`;
  });
  return sections.join('\n\n');
}

function buildPayload({
  branch = 'chore/65-pr-review-governance',
  body = buildBody(),
  draft = false,
  changedFiles = 5,
  additions = 100,
  deletions = 20,
} = {}) {
  return {
    pull_request: {
      head: { ref: branch },
      body,
      draft,
      changed_files: changedFiles,
      additions,
      deletions,
    },
  };
}

const existingIssue = async (repository, issueNumber) => ({
  repository,
  number: issueNumber,
});

test('数字 Issue 分支和完整 Ready PR 可以通过', async () => {
  const errors = await validatePullRequest(buildPayload(), {
    repository: 'owner/repo',
    issueLoader: existingIssue,
  });
  assert.deepEqual(errors, []);
});

test('Draft PR 允许检查清单暂未勾选', async () => {
  const errors = await validatePullRequest(
    buildPayload({ body: buildBody({ checked: false }), draft: true }),
    { repository: 'owner/repo', issueLoader: existingIssue },
  );
  assert.deepEqual(errors, []);
});

test('Ready PR 不允许未勾选检查项', async () => {
  const errors = await validatePullRequest(
    buildPayload({ body: buildBody({ checked: false }) }),
    { repository: 'owner/repo', issueLoader: existingIssue },
  );
  assert.ok(errors.some((error) => error.includes('未勾选')));
});

test('no-issue 仅允许 docs 和 chore', async () => {
  const invalid = await validatePullRequest(
    buildPayload({ branch: 'fix/no-issue-runtime-change' }),
    { repository: 'owner/repo', issueLoader: existingIssue },
  );
  assert.ok(invalid.some((error) => error.includes('no-issue')));

  const valid = await validatePullRequest(
    buildPayload({ branch: 'docs/no-issue-fix-typo' }),
    { repository: 'owner/repo', issueLoader: existingIssue },
  );
  assert.deepEqual(valid, []);
});

test('缺少章节或 Issue 关闭引用时失败', async () => {
  const body = buildBody().replace('## 验证\n\n已填写', '验证已填写');
  const errors = await validatePullRequest(buildPayload({ body }), {
    repository: 'owner/repo',
    issueLoader: existingIssue,
  });
  assert.ok(errors.some((error) => error.includes('## 验证')));

  const noClosingReference = buildBody().replace('Closes #65', 'Issue #65');
  const referenceErrors = await validatePullRequest(
    buildPayload({ body: noClosingReference }),
    { repository: 'owner/repo', issueLoader: existingIssue },
  );
  assert.ok(referenceErrors.some((error) => error.includes('Closes #65')));
});

test('超大 PR 必须填写不可拆分原因', async () => {
  const errors = await validatePullRequest(
    buildPayload({
      body: buildBody({ reason: '不适用' }),
      changedFiles: 16,
      additions: 900,
      deletions: 200,
    }),
    { repository: 'owner/repo', issueLoader: existingIssue },
  );
  assert.ok(errors.some((error) => error.includes('粒度警戒线')));

  const valid = await validatePullRequest(
    buildPayload({
      body: buildBody({ reason: '纯机械迁移必须一次保持目录引用一致' }),
      changedFiles: 16,
      additions: 900,
      deletions: 200,
    }),
    { repository: 'owner/repo', issueLoader: existingIssue },
  );
  assert.deepEqual(valid, []);
});
