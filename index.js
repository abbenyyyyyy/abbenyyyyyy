const core = require("@actions/core");
let Parser = require("rss-parser");
const { spawn } = require("child_process");
const fs = require("fs");
const dayjs = require("dayjs");

const RSS_URL = "https://blog.abbenyyy.cn/feed.xml";
const MAX_BLOG_COUNT = 8;
const DATA_FORMAT_STYLE = "YYYY-MM-DD";
const README_FILE_PATH = "./README.md";

/**
 * 生成 readme 新文本
 * @param {string} previousContent 旧的 readme 文本
 * @param {string} newContent 需要替换添加到 readme 的文本
 *
 * @returns {string || null} 新的 readme 文本,若相同不用替换就返回null
 */
const buildNewReadme = (previousContent, newContent) => {
  // 寻找替换位置
  const startTag = "博客最近更新";
  const endTag = "  [more]";
  const startOfOpening = previousContent.indexOf(startTag);
  const endOfOpening = previousContent.indexOf(endTag);
  if (startOfOpening === -1 || endOfOpening === -1) {
    core.setFailed("无法在 readme 中找到替换的tag.");
  } else {
    const willReplaceContent = previousContent.slice(
      startOfOpening + startTag.length,
      endOfOpening
    );
    core.notice(`原文本:${willReplaceContent}`);
    // 比对新的 readme 文本 与 旧的是否一致
    if (willReplaceContent === newContent) {
      return null;
    } else {
      return [
        previousContent.slice(
          0,
          startOfOpening + startTag.length,
          endOfOpening
        ),
        "\n",
        newContent,
        previousContent.slice(endOfOpening, previousContent.length),
      ].join("");
    }
  }
};

/**
 * 执行命令并将其结果作为 promise 返回
 * @param cmd {string} 要执行的命令
 * @param args {array} 命令参数
 * @param options {Object} 其余参数
 * @return {Promise<Object>}
 */
const exec = (cmd, args = [], options = {}) =>
  new Promise((resolve, reject) => {
    let outputData = "";
    const optionsToCLI = {
      ...options,
    };
    if (!optionsToCLI.stdio) {
      Object.assign(optionsToCLI, { stdio: ["inherit", "inherit", "inherit"] });
    }
    const app = spawn(cmd, args, optionsToCLI);
    if (app.stdout) {
      // Only needed for pipes
      app.stdout.on("data", function (data) {
        outputData += data.toString();
      });
    }

    app.on("close", (code) => {
      if (code !== 0) {
        return reject({ code, outputData });
      }
      return resolve({ code, outputData });
    });
    app.on("error", () => reject({ code: 1, outputData }));
  });

const main = async () => {
  // 从博客RSS中拉取数据，构造新的 '博客最近更新'
  let addReadme = "";
  let parser = new Parser();
  let feed = await parser.parseURL(RSS_URL);
  let addCount =
    feed.items.length > MAX_BLOG_COUNT ? MAX_BLOG_COUNT : feed.items.length;
  for (let i = 0; i < addCount; i++) {
    let feedItem = feed.items[i];
    const publishedDate = dayjs(feedItem.pubDate);
    addReadme =
      addReadme +
      `- [${feedItem.title}](${feedItem.link}) - ${publishedDate.format(
        DATA_FORMAT_STYLE
      )} \n`;
  }
  addReadme = addReadme + "\n";
  core.notice(`新替换文本:${addReadme}`);
  // 读取原本的 readme , 然后构建新的 readme , 再比对新旧是否相同
  const readmeData = fs.readFileSync(README_FILE_PATH, "utf-8");
  const newReadme = buildNewReadme(readmeData, addReadme);
  if (newReadme) {
    core.notice(`写入新文本:${newReadme}`);
    fs.writeFileSync(README_FILE_PATH, newReadme);
    // 将变化提交到github
    const GITHUB_TOKEN = core.getInput("gh_token");
    const COMMITTER_USERNAME = core.getInput("committer_username");
    const COMMITTER_EMAIL = core.getInput("committer_email");
    // 将 GITHUB_TOKEN 设为秘密，不在日志中显示
    core.setSecret(GITHUB_TOKEN);
    core.notice("执行 git 设置命令");
    await exec("git", ["config", "--global", "user.email", COMMITTER_EMAIL]);
    if (GITHUB_TOKEN) {
      await exec("git", [
        "remote",
        "set-url",
        "origin",
        `https://${GITHUB_TOKEN}@github.com/${process.env.GITHUB_REPOSITORY}.git`,
      ]);
    }
    await exec("git", ["config", "--global", "user.name", COMMITTER_USERNAME]);
    await exec("git", ["add", README_FILE_PATH]);
    await exec("git", ["commit", "-m", ":auto update"]);
    await exec("git", ["push"]);
    core.info("完成更新 readme");
  }
};

main();
