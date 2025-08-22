export const runtime = "edge";

type SpecRequest = {
  prompt: string;
  columns: { name: string; dtype: string }[];
};

type ChartSpec = {
  type: "bar" | "line" | "scatter" | "histogram" | "box" | "pie" | "area";
  x?: string;
  y?: string;
  color?: string;
  agg?: "sum" | "mean" | "count" | "median" | "max" | "min";
  title?: string;
};

function heuristicSpec(req: SpecRequest): ChartSpec {
  const p = req.prompt.toLowerCase();
  const spec: ChartSpec = { type: "bar", agg: "sum", title: req.prompt };

  if (/(trend|over time|time series)/.test(p)) spec.type = "line";
  else if (/histogram|distribution/.test(p)) spec.type = "histogram";
  else if (/scatter/.test(p)) spec.type = "scatter";
  else if (/box/.test(p)) spec.type = "box";
  else if (/pie|share/.test(p)) spec.type = "pie";
  else if (/area/.test(p)) spec.type = "area";

  if (/average|mean/.test(p)) spec.agg = "mean";
  else if (/count|number of/.test(p)) spec.agg = "count";
  else if (/median/.test(p)) spec.agg = "median";
  else if (/max/.test(p)) spec.agg = "max";
  else if (/min/.test(p)) spec.agg = "min";

  const byMatch = p.match(/by\s+([a-z0-9_\-\s]+)/);
  if (byMatch) spec.x = byMatch[1].trim();

  const colorMatch = p.match(/color\s+by\s+([a-z0-9_\-\s]+)/);
  if (colorMatch) spec.color = colorMatch[1].trim();

  const useMatch = p.match(/use\s+([a-z0-9_\-\s]+)/);
  if (useMatch) spec.y = useMatch[1].trim();

  return spec;
}

export async function POST(req: Request) {
  const body = (await req.json()) as SpecRequest;
  const spec = heuristicSpec(body);
  return new Response(JSON.stringify({ spec }), {
    headers: { "content-type": "application/json" }
  });
}
