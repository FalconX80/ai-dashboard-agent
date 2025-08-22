import "../styles/globals.css";

export const metadata = {
  title: "AI Dashboard Agent",
  description: "Generate interactive dashboards from CSV/Excel"
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <script defer src="https://cdn.plot.ly/plotly-2.30.0.min.js" />
        <script defer src="https://cdn.jsdelivr.net/pyodide/v0.25.1/full/pyodide.js" />
        <link rel="icon" href="/favicon.ico" />
      </head>
      <body>{children}</body>
    </html>
  );
}
