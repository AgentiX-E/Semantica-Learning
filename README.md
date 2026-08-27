# Semantica-Learning

> 深入浅出地学习 [Semantica](https://github.com/semantica-agi/semantica)（原 BuildSemantica）——一个「Graph-Native Infrastructure for Context and Accountable AI Systems」——并用 **Node.js / TypeScript** 从零逐步复刻一个 100% 能力对齐的产品 **semantica-ts**。

这是一个**交互式学习网站** + **可运行参考实现**的 Monorepo：

```
Semantica-Learning/
├── index.html                 # 交互式课程网站（GitHub Pages 入口）
├── assets/
│   ├── styles.css             # 深色主题样式
│   ├── app.js                 # SPA 导航 / 测验 / 代码高亮 / 图可视化
│   └── semantica-playground.js # 浏览器内可运行的 mini 版 semantica 核心
└── semantica-ts/              # TypeScript 完整参考实现（98 测试）
    ├── src/                   # 各模块源码
    └── tests/                 # TDD 测试套件
```

## 网站内容

**Part A · 认识 Semantica**（12 章）

1. 概览与定位 — 它解决什么问题、与向量库/LLM 记忆的对比
2. 核心概念 — 知识图谱、NER、GraphRAG、六种推理、时序、溯源
3. 架构与 27 模块 — 端到端流水线、六大逻辑层、模块全索引
4. 数据流水线 — Ingest → Parse → Normalize → Split → Extract
5. 知识图谱构建 — GraphBuilder、双时态、图算法
6. 推理引擎 — 前向链 / Rete / Datalog / SPARQL / 演绎 / 溯因
7. 本体与治理 — SHACL / OWL / SKOS
8. 溯源与审计 — W3C PROV-O
9. 决策智能 — 决策生命周期、因果链、判例、策略门禁
10. 冲突与去重 — 冲突解决、实体消歧
11. 存储层 — 多语言图存储 + 向量库
12. 交互实验室 — 浏览器内亲手运行 mini 版 semantica

**Part B · 复刻 semantica-ts**（8 阶段 + 测验）

- 阶段 0–7：从脚手架到存储导出，逐步复刻（TDD）
- 阶段 8：100% 能力对齐清单
- 结业测验：10 题自动评分

## 运行 semantica-ts

```bash
cd semantica-ts
npm install
npm run typecheck    # strict TypeScript
npm test             # 98 tests passed
npm run coverage     # 97.92% statements · 100% functions · 82.42% branches
```

## 本地预览网站

```bash
# 任意静态服务器均可，例如：
python3 -m http.server 8080
# 打开 http://localhost:8080
```

## 发布 GitHub Pages

仓库已配置为私有仓库 + GitHub Pages（从默认分支根目录发布）。

## License

MIT
