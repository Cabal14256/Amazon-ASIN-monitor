#!/usr/bin/env node

const fs = require('fs');

const BRANCH_PATTERN =
  /^(feat|fix|docs|refactor|test|chore|codex)\/(\d+|no-issue)-([a-z0-9]+(?:-[a-z0-9]+)*)$/;
const REQUIRED_HEADINGS = [
  '关联 Issue',
  '背景与问题',
  '本次修复',
  '影响范围',
  '风险与回滚',
  'PR 粒度说明',
  '验证',
  '截图或日志',
  '回归建议',
  '检查清单',
];
const MINIMUM_CHECKLIST_ITEMS = 9;

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasHeading(body, heading) {
  return new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, 'm').test(body);
}

function getSection(body, heading) {
  const headingPattern = new RegExp(
    `^##\\s+${escapeRegExp(heading)}\\s*$`,
    'm',
  );
  const headingMatch = headingPattern.exec(body);
  if (!headingMatch) {
    return '';
  }

  const sectionStart = headingMatch.index + headingMatch[0].length;
  const remainingBody = body.slice(sectionStart);
  const nextHeading = /^##\s+/m.exec(remainingBody);
  const section = nextHeading
    ? remainingBody.slice(0, nextHeading.index)
    : remainingBody;
  return section.trim();
}

async function fetchIssue(repository, issueNumber, token) {
  if (!token) {
    throw new Error('GITHUB_TOKEN is required to validate the linked Issue');
  }

  const response = await fetch(
    `https://api.github.com/repos/${repository}/issues/${issueNumber}`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  );
  if (!response.ok) {
    return null;
  }
  const issue = await response.json();
  return issue.pull_request ? null : issue;
}

async function validatePullRequest(
  payload,
  {
    repository = process.env.GITHUB_REPOSITORY,
    token = process.env.GITHUB_TOKEN,
    issueLoader = fetchIssue,
  } = {},
) {
  const pullRequest = payload?.pull_request;
  if (!pullRequest) {
    return ['GitHub event does not contain pull_request data'];
  }

  const errors = [];
  const branch = String(pullRequest.head?.ref || '');
  const body = String(pullRequest.body || '');
  const branchMatch = branch.match(BRANCH_PATTERN);

  if (!branchMatch) {
    errors.push(
      '分支名必须符合 type/<issue>-<slug>，type 为 feat|fix|docs|refactor|test|chore|codex。',
    );
  } else {
    const [, type, issuePart] = branchMatch;
    if (issuePart === 'no-issue') {
      if (!['docs', 'chore'].includes(type)) {
        errors.push('no-issue 只允许用于 docs/* 或 chore/* 分支。');
      }
    } else {
      const closingPattern = new RegExp(
        `\\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\\s+#${issuePart}\\b`,
        'i',
      );
      if (!closingPattern.test(body)) {
        errors.push(
          `PR 正文必须使用 Closes #${issuePart} 关联分支对应 Issue。`,
        );
      }

      try {
        const issue = await issueLoader(repository, Number(issuePart), token);
        if (!issue) {
          errors.push(`未找到可关联的 GitHub Issue #${issuePart}。`);
        }
      } catch (error) {
        errors.push(`无法验证 GitHub Issue #${issuePart}：${error.message}`);
      }
    }
  }

  for (const heading of REQUIRED_HEADINGS) {
    if (!hasHeading(body, heading)) {
      errors.push(`PR 正文缺少必需章节：## ${heading}`);
    }
  }

  const changedFiles = Number(pullRequest.changed_files) || 0;
  const changedLines =
    (Number(pullRequest.additions) || 0) + (Number(pullRequest.deletions) || 0);
  if (changedFiles > 15 || changedLines > 1000) {
    const sizeSection = getSection(body, 'PR 粒度说明');
    const reason = sizeSection.match(
      /如超过，为什么不能拆分\s*[:：]\s*(.+)/,
    )?.[1];
    if (
      !reason ||
      /^(?:无|否|不适用|n\/?a|todo|待填写|<.*>)$/i.test(reason.trim())
    ) {
      errors.push(
        `PR 已超过粒度警戒线（${changedFiles} 个文件，${changedLines} 行变化），必须说明为什么不能拆分。`,
      );
    }
  }

  if (!pullRequest.draft) {
    const checklistSection = getSection(body, '检查清单');
    const checklistItems =
      checklistSection.match(/^\s*-\s+\[[ xX]\].+$/gm) || [];
    const uncheckedItems = checklistItems.filter((item) => /\[ \]/.test(item));
    if (checklistItems.length < MINIMUM_CHECKLIST_ITEMS) {
      errors.push(
        `Ready PR 的检查清单至少需要 ${MINIMUM_CHECKLIST_ITEMS} 项。`,
      );
    }
    if (uncheckedItems.length > 0) {
      errors.push('Ready PR 的检查清单仍有未勾选项目。');
    }
  }

  return errors;
}

async function main() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    throw new Error('GITHUB_EVENT_PATH is required');
  }
  const payload = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
  const errors = await validatePullRequest(payload);
  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`::error::${error}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log('PR policy check passed.');
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`::error::PR policy check failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  BRANCH_PATTERN,
  REQUIRED_HEADINGS,
  getSection,
  validatePullRequest,
};
