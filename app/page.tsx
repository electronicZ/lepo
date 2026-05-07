import Link from "next/link";

export default function Home() {
  const tools = [
    {
      emoji: "📝",
      name: "文案生成",
      description: "输入主题，AI 帮你生成营销文案",
      href: "/copywriting",
    },
    {
      emoji: "🔍",
      name: "提示词反推",
      description: "上传图片，反推出 AI 绘图提示词",
      href: "/prompt-reverse",
    },
    {
      emoji: "🎨",
      name: "AI 生图",
      description: "输入描述，生成精美图片",
      href: "/image-generation",
    },
  ];

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <main className="mx-auto w-full max-w-6xl px-6 py-16 md:px-10 md:py-24">
        <header className="mb-12 text-center">
          <h1 className="text-4xl font-bold tracking-tight md:text-5xl">AI 工具台</h1>
          <p className="mx-auto mt-4 max-w-2xl text-base text-slate-600 md:text-lg">
            一个简洁高效的创作入口，快速完成文案生成、提示词反推与 AI 生图任务。
          </p>
        </header>

        <section className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {tools.map((tool) => (
            <article
              key={tool.name}
              className="group rounded-2xl bg-gradient-to-br from-violet-500/60 via-cyan-400/40 to-fuchsia-500/60 p-[1px] transition-transform duration-300 hover:-translate-y-1"
            >
              <div className="flex h-full flex-col rounded-2xl bg-white p-6">
                <div className="mb-4 text-4xl leading-none">{tool.emoji}</div>
                <h2 className="text-xl font-semibold text-slate-900">{tool.name}</h2>
                <p className="mt-3 flex-1 text-sm leading-6 text-slate-600">
                  {tool.description}
                </p>
                <Link
                  href={tool.href}
                  className="mt-6 inline-flex w-fit items-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
                >
                  进入
                </Link>
              </div>
            </article>
          ))}
        </section>
      </main>
    </div>
  );
}
