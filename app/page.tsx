"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */
type Column = { name: string; dtype: string };
type Spec = {
  type: "bar" | "line" | "scatter" | "histogram" | "box" | "pie" | "area";
  x?: string;
  y?: string;
  color?: string;
  agg?: "sum" | "mean" | "count" | "median" | "max" | "min";
  title?: string;
};

declare global {
  interface Window {
    pyodide: any;
    loadPyodide: any;
    Plotly: any;
  }
}

/* ------------------------------------------------------------------ */
/*  Page component                                                    */
/* ------------------------------------------------------------------ */
export default function Home() {
  /* UI state */
  const [pyLoaded, setPyLoaded] = useState(false);
  const [fileName, setFileName] = useState("");
  const [columns, setColumns] = useState<Column[]>([]);
  const [prompt, setPrompt] = useState(
    "Show sales trend over time by month and region"
  );
  const [tablePreview, setTablePreview] = useState<string[][]>([]);
  const [hint, setHint] = useState("");

  /* refs */
  const dataRef = useRef<any>(null);
  const chartRef = useRef<HTMLDivElement>(null);

  /* -------------------------------------------------------------- */
  /*  Boot Pyodide once                                             */
  /* -------------------------------------------------------------- */
  useEffect(() => {
    const boot = async () => {
      /* wait until pyodide script is injected */
      await new Promise<void>((res) => {
        const check = () =>
          window.loadPyodide ? res() : setTimeout(check, 200);
        check();
      });
      const pyodide = await window.loadPyodide({
        indexURL: "https://cdn.jsdelivr.net/pyodide/v0.25.1/full/"
      });
      await pyodide.loadPackage(["pandas", "openpyxl"]);
      window.pyodide = pyodide;
      setPyLoaded(true);
    };
    boot();
  }, []);

  /* -------------------------------------------------------------- */
  /*  Helpers                                                       */
  /* -------------------------------------------------------------- */
  const readFileToDf = async (file: File) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await window.pyodide.FS.writeFile(file.name, bytes);
    const code = `
import pandas as pd, os
path = "${file.name}"
ext = os.path.splitext(path)[1].lower()
if ext in [".xls", ".xlsx"]:
    df = pd.read_excel(path)
else:
    try:
        df = pd.read_csv(path)
    except Exception:
        df = pd.read_csv(path, sep=";")
df.columns = [str(c).strip() for c in df.columns]
types = [(c, str(df[c].dtype)) for c in df.columns]
preview = df.head(12).fillna("").astype(str).values.tolist()
`;
    await window.pyodide.runPythonAsync(code);
    dataRef.current = window.pyodide.globals.get("df");
    setColumns(window.pyodide.globals.get("types").toJs());
    setTablePreview(window.pyodide.globals.get("preview").toJs());
    setHint(
      "Tip: Try prompts like 'Total revenue by region (bar)', 'Monthly average price (line)'."
    );
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f || !pyLoaded) return;
    setFileName(f.name);
    await readFileToDf(f);
  };

  const getSpec = async (): Promise<Spec> => {
    const res = await fetch("/api/spec", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt, columns })
    });
    const { spec } = await res.json();
    return spec as Spec;
  };

  const plot = async () => {
    if (!dataRef.current || !chartRef.current) return;
    const spec = await getSpec();

    /* Python summarisation inside Pyodide */
    const code = `
import pandas as pd, json
df = globals().get("df")
spec = json.loads("""${JSON.stringify(spec)}""")
x = spec.get("x")
y = spec.get("y")
color = spec.get("color")
agg = spec.get("agg", "sum")
typ = spec.get("type")

def summarize(df, x, y, color, agg, typ):
    if typ in ["histogram", "box"] and not y:
        num_cols = [c for c in df.columns if str(df[c].dtype).startswith(("int","float"))]
        y = num_cols[0] if num_cols else None
    if y and agg != "count" and typ not in ["histogram", "pie", "box"]:
        if color and x: g = df.groupby([x, color])[y]
        elif x:         g = df.groupby(x)[y]
        else:           g = df[y]
        s = (
            g.sum()     if agg=="sum"   else
            g.mean()    if agg=="mean"  else
            g.median()  if agg=="median"else
            g.max()     if agg=="max"   else
            g.min()     if agg=="min"   else
            g.size()
        ).reset_index()
        return s
    elif typ == "histogram":
        return df[[y]].dropna()
    elif typ == "box":
        cols = [c for c in [x, y] if c]; return df[cols] if cols else df
    else:
        if color and x: return df.groupby([x, color]).size().reset_index(name="count")
        elif x:        return df.groupby(x).size().reset_index(name="count")
        else:          return df

sdf = summarize(df, x, y, color, agg, typ)
data = {c: sdf[c].tolist() for c in sdf.columns}
`;
    await window.pyodide.runPythonAsync(code);
    const data = window.pyodide.globals.get("data").toJs();

    /* Build Plotly traces */
    const Plotly = window.Plotly;
    const layout = {
      template: "plotly_dark",
      paper_bgcolor: "#0a0a0a",
      plot_bgcolor: "#0a0a0a",
      font: { color: "#fff" },
      margin: { t: 56, r: 20, b: 56, l: 56 },
      title: spec.title || "Generated Chart",
      legend: { orientation: "h", x: 0, y: 1.1 }
    };

    const traces: any[] = [];
    const keys = Object.keys(data);
    const x = data[spec.x ?? keys[0]];

    const yKey =
      spec.type === "histogram"
        ? String(spec.y ?? keys)
        : spec.type === "pie"
        ? String(spec.y ?? "count")
        : spec.agg === "count"
        ? "count"
        : String(spec.y ?? keys[1]);

    const color = spec.color && data[spec.color] ? data[spec.color] : undefined;

    if (spec.type === "histogram") {
      traces.push({
        type: "histogram",
        x: data[String(yKey)],
        marker: { color: "#60a5fa" }
      });
    } else if (spec.type === "pie") {
      traces.push({
        type: "pie",
        labels: x,
        values: data[String(yKey)],
        hole: 0.4
      });
    } else if (spec.type === "box") {
      traces.push({
        type: "box",
        x,
        y: data[String(yKey)],
        marker: { color: "#a78bfa" }
      });
    } else {
      if (color) {
        const groups = Array.from(new Set(color));
        groups.forEach((g) => {
          const idxs = color
            .map((v: string, i: number) => (v === g ? i : -1))
            .filter((i) => i !== -1);
          traces.push({
            type: spec.type === "line" ? "scatter" : spec.type,
            mode: spec.type === "line" ? "lines+markers" : undefined,
            x: idxs.map((i) => x[i]),
            y: idxs.map((i) => data[String(yKey)][i]),
            name: String(g)
          });
        });
      } else {
        traces.push({
          type: spec.type === "line" ? "scatter" : spec.type,
          mode: spec.type === "line" ? "lines+markers" : undefined,
          x,
          y: data[String(yKey)]
        });
      }
    }

    await Plotly.react(chartRef.current!, traces, layout, {
      responsive: true,
      displaylogo: false,
      modeBarButtonsToRemove: ["lasso2d", "select2d"]
    });

    setHint(
      "Tip: Refine with prompts like 'stacked area by segment', 'count of orders by status', 'top 10 categories by revenue'."
    );
  };

  /* -------------------------------------------------------------- */
  /*  Render                                                        */
  /* -------------------------------------------------------------- */
  return (
    <main className="min-h-screen">
      {/* Nav */}
      <nav className="border-b border-zinc-800 sticky top-0 backdrop-blur bg-neutral-900/70 z-10">
        <div className="container flex items-center justify-between h-16">
          <div className="text-lg font-semibold">AI Dashboard Agent</div>
          <div className="text-sm text-zinc-400">Vercel Edge • Pyodide • Plotly</div>
        </div>
      </nav>

      {/* Body */}
      <section className="container py-8 grid gap-6">
        {/* Upload + Prompt */}
        <div className="grid md:grid-cols-3 gap-6">
          <div className="md:col-span-2 bg-neutral-950 border border-zinc-800 rounded-lg p-4">
            <div className="flex items-center justify-between gap-3">
              <label className="text-sm text-zinc-300">Upload CSV or Excel</label>
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={handleFile}
                className="text-sm file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-white file:text-black hover:file:bg-zinc-200"
              />
            </div>
            {fileName && (
              <div className="mt-2 text-xs text-zinc-400">Loaded: {fileName}</div>
            )}

            <div className="mt-4">
              <label className="text-sm text-zinc-300">Prompt</label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                className="mt-1 w-full h-24 bg-neutral-900 border border-zinc-800 rounded-md p-2 text-sm"
                placeholder="e.g., Show total revenue by region (bar), color by segment"
              />
              <div className="mt-2 flex items-center gap-2">
                <Button onClick={plot} disabled={!pyLoaded || !columns.length}>
                  Generate Chart
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    setPrompt(
                      "Show sales trend over time by month and region"
                    )
                  }
                >
                  Example
                </Button>
              </div>
              {!pyLoaded && (
                <div className="mt-2 text-xs text-zinc-500">
                  Loading Python runtime...
                </div>
              )}
              {hint && <div className="mt-3 text-xs text-zinc-400">{hint}</div>}
            </div>
          </div>

          {/* Sidebar — columns + preview */}
          <div className="bg-neutral-950 border border-zinc-800 rounded-lg p-4">
            <div className="text-sm text-zinc-300">Detected Columns</div>
            <div className="mt-2 text-xs text-zinc-400 min-h-[40px]">
              {columns.length ? (
                columns.map((c, i) => (
                  <div key={i} className="py-0.5">
                    {c.name}{" "}
                    <span className="text-zinc-600">({c.dtype})</span>
                  </div>
                ))
              ) : (
                <div>No file loaded</div>
              )}
            </div>
            <div className="mt-4 text-sm text-zinc-300">Preview</div>
            <div className="mt-2 max-h-48 overflow-auto border border-zinc-800 rounded-md">
              <table className="w-full text-xs">
                <tbody>
                  {tablePreview.map((row, i) => (
                    <tr key={i} className="odd:bg-neutral-900">
                      {row.map((cell, j) => (
                        <td key={j} className="p-2 border-r border-zinc-800">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Chart */}
        <div className="bg-neutral-950 border border-zinc-800 rounded-lg p-4">
          <div className="text-sm text-zinc-300 mb-2">Interactive Chart</div>
          <div
            ref={chartRef}
            className="w-full min-h-[520px] rounded-md border border-zinc-800"
          />
        </div>
      </section>
    </main>
  );
}
