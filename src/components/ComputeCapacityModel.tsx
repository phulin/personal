import { DollarSign, ExternalLink, Gauge, Info, Zap } from "lucide-react";
import { type ComponentType, useMemo, useState } from "react";
import {
	Bar,
	CartesianGrid,
	ComposedChart,
	Legend,
	Line,
	LineChart,
	ReferenceArea,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";

type Preset = "bear" | "central" | "bull";
type Scenario = Preset | "custom";
type Company = "Anthropic" | "OpenAI";
type RevenueView = "net" | "gross";
type CompanyFilter = "All" | Company;
type ForecastMode = "manual" | "blended" | "premium";

// First N periods treated as historical and used to anchor forecast $/GW.
const HISTORICAL_PERIODS = 4;

interface Period {
	key: string;
	label: string;
	year: number;
	half: "H1" | "H2";
}

const PERIODS: Period[] = [
	{ key: "2024H1", label: "H1 2024", year: 2024, half: "H1" },
	{ key: "2024H2", label: "H2 2024", year: 2024, half: "H2" },
	{ key: "2025H1", label: "H1 2025", year: 2025, half: "H1" },
	{ key: "2025H2", label: "H2 2025", year: 2025, half: "H2" },
	{ key: "2026H1", label: "H1 2026", year: 2026, half: "H1" },
	{ key: "2026H2", label: "H2 2026", year: 2026, half: "H2" },
	{ key: "2027H1", label: "H1 2027", year: 2027, half: "H1" },
	{ key: "2027H2", label: "H2 2027", year: 2027, half: "H2" },
];

const PRESETS: Preset[] = ["bear", "central", "bull"];

type ScenarioSeries = Record<Company, Record<Preset, number[]>>;

// 2024H1, 2024H2, 2025H1, 2025H2 are completed periods — scenario variants
// reuse the central values so toggling bull/bear only affects the forecast.
const gwAssumptions: ScenarioSeries = {
	Anthropic: {
		bear: [0.06, 0.12, 0.23, 0.5, 0.8, 2.4, 4.0, 6.8],
		central: [0.06, 0.12, 0.23, 0.5, 1.1, 3.2, 5.8, 10.0],
		bull: [0.06, 0.12, 0.23, 0.5, 1.5, 4.5, 8.0, 14.0],
	},
	OpenAI: {
		bear: [0.25, 0.44, 0.81, 1.4, 2.8, 5.0, 8.5, 13.5],
		central: [0.25, 0.44, 0.81, 1.4, 3.8, 7.0, 12.0, 20.0],
		bull: [0.25, 0.44, 0.81, 1.4, 5.5, 10.0, 18.0, 30.0],
	},
};

const grossRevenueHalfYear: Record<Company, number[]> = {
	Anthropic: [0.12, 0.45, 1.4, 4.1],
	OpenAI: [1.4, 2.3, 4.5, 8.5],
};

// Initial values for the editable forecast slots. Only consumed by "manual"
// forecast mode; "blended" and "premium" recompute these on the fly.
const initialGrossForecast: Record<Company, number[]> = {
	Anthropic: [20, 35, 55, 85],
	OpenAI: [22, 35, 58, 90],
};

interface DealAnchor {
	company: Company;
	deal: string;
	reported: string;
	modelUse: string;
	firmness: string;
	url: string;
}

const dealAnchors: DealAnchor[] = [
	{
		company: "Anthropic",
		deal: "Colossus 1 / SpaceX-xAI capacity lease",
		reported: "~300 MW, 220k+ Nvidia GPUs, rapid availability in 2026",
		modelUse:
			"Adds near-term H2 2026 inference-heavy capacity; mostly included in central Anthropic H2 2026 uplift.",
		firmness: "High for near-term capacity, medium for economic duration",
		url: "https://www.reuters.com/business/retail-consumer/anthropic-unveils-dreaming-feature-help-its-ai-agents-self-improve-2026-05-06/",
	},
	{
		company: "Anthropic",
		deal: "Google TPU 2026 arrangement",
		reported: ">1 GW of AI compute capacity in 2026",
		modelUse:
			"Central model assumes partial contribution in H1 2026 and larger contribution in H2 2026.",
		firmness: "High",
		url: "https://www.reuters.com/technology/anthropic-expand-use-google-clouds-tpu-chips-2025-10-23/",
	},
	{
		company: "Anthropic",
		deal: "Google/Broadcom TPU expansion",
		reported: "~3.5 GW of Google TPU capacity starting in 2027",
		modelUse:
			"Primary driver of Anthropic's 2027 step-up; bull case assumes faster utilization and fewer delays.",
		firmness: "Medium-high",
		url: "https://www.reuters.com/business/broadcom-signs-long-term-deal-develop-googles-custom-ai-chips-2026-04-06/",
	},
	{
		company: "Anthropic",
		deal: "AWS / Project Rainier / Trainium",
		reported:
			"~1 GW by year-end 2026; up to ~5 GW over time in expanded Amazon partnership",
		modelUse:
			"Assumes AWS remains a major training + inference backplane; not all headline GW is counted as usable by 2027.",
		firmness: "Medium-high",
		url: "https://www.ft.com/content/fbf89a69-5a8b-4774-b3a8-3c6621263923",
	},
	{
		company: "Anthropic",
		deal: "Microsoft/Nvidia Azure arrangement",
		reported:
			"Up to ~1 GW of Nvidia systems; Anthropic to buy Azure compute capacity",
		modelUse:
			"Base case includes partial 2027 contribution; bear case treats timing as limited.",
		firmness: "Medium",
		url: "https://www.anthropic.com/news/anthropic-microsoft-nvidia",
	},
	{
		company: "OpenAI",
		deal: "Nvidia systems partnership / LOI",
		reported:
			"At least 10 GW of Nvidia systems, first 1 GW targeted for H2 2026",
		modelUse:
			"Heavily haircut in 2026 because it is a staged LOI; material in 2027 bull case.",
		firmness: "Medium-low near term; higher as supply chain locks",
		url: "https://openai.com/index/openai-nvidia-systems-partnership/",
	},
	{
		company: "OpenAI",
		deal: "AMD Instinct agreement",
		reported: "6 GW total, first 1 GW from H2 2026",
		modelUse:
			"Included as staged 2026/2027 capacity; bull case assumes accelerated deployment.",
		firmness: "Medium-high",
		url: "https://openai.com/index/amd-openai-strategic-partnership/",
	},
	{
		company: "OpenAI",
		deal: "Oracle / Stargate",
		reported:
			"4.5 GW additional Oracle data-center capacity; >5 GW under construction including Abilene",
		modelUse:
			"Major 2027 source, but discounted because some facilities reportedly shift toward 2028.",
		firmness: "Medium",
		url: "https://www.reuters.com/business/oracle-openai-add-45-gigawatts-data-center-capacity-stargate-venture-2025-07-22/",
	},
	{
		company: "OpenAI",
		deal: "AWS seven-year cloud deal",
		reported:
			"$38B agreement, full capacity expected by end-2026 with room to expand in 2027",
		modelUse:
			"Included as a meaningful H2 2026 and 2027 inference/training supply line, but converted from dollars to GW by assumption.",
		firmness: "Medium-high",
		url: "https://www.reuters.com/business/retail-consumer/openai-amazon-strike-38-billion-agreement-chatgpt-maker-use-aws-2025-11-03/",
	},
	{
		company: "OpenAI",
		deal: "Broadcom custom accelerators",
		reported:
			"10 GW target, deployments beginning late 2026 and extending through 2029",
		modelUse: "Small 2027 base contribution; large post-2027 option value.",
		firmness: "Medium-low for 2027",
		url: "https://apnews.com/article/1bef0e0216d3878feefcb003e89b08e4",
	},
	{
		company: "OpenAI",
		deal: "CoreWeave cloud contracts",
		reported:
			"OpenAI-CoreWeave contracts reported at $22B+ aggregate by late 2025",
		modelUse:
			"Backfills 2025-2027 OpenAI capacity where no clean GW disclosure exists.",
		firmness: "Medium-high",
		url: "https://www.reuters.com/business/coreweave-expands-openai-pact-with-new-65-billion-contract-2025-09-25/",
	},
];

interface RevenueAnchor {
	company: Company;
	anchor: string;
	value: string;
	modelUse: string;
	url?: string;
}

const revenueAnchors: RevenueAnchor[] = [
	{
		company: "Anthropic",
		anchor: "Run-rate revenue",
		value:
			"Reported >$30B ARR and projected ~$45B-$50B annualized by mid-2026 in recent press reports.",
		modelUse:
			"Forces high implied $/GW in 2026 unless capacity is materially undercounted.",
	},
	{
		company: "Anthropic",
		anchor: "Gross accounting risk",
		value:
			"Reported revenue may include cloud marketplace/provider channel revenue gross of AWS/Google cuts. OpenAI's April 2026 internal memo accused Anthropic of inflating its run rate by ~$8B via gross-basis accounting.",
		modelUse: "Default net-retained haircut: 20%, adjustable below.",
		url: "https://www.cnbc.com/2026/04/09/openai-slams-anthropic-in-memo-to-shareholders-as-rival-gains-momentum.html",
	},
	{
		company: "OpenAI",
		anchor: "Run-rate revenue",
		value:
			"Reported $12B annualized in mid-2025 and >$20B annualized by early 2026.",
		modelUse:
			"OpenAI has larger compute book but lower apparent monetization per GW due to consumer/free/research mix.",
	},
	{
		company: "OpenAI",
		anchor: "Microsoft revenue share",
		value:
			"Reported revenue-sharing cap of $38B; payments continue through 2030 under revised structure.",
		modelUse: "Default net-retained haircut: 15%, adjustable below.",
	},
];

function currency(value: number | null | undefined): string {
	if (!Number.isFinite(value as number)) return "—";
	const v = value as number;
	return `$${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)}B`;
}

function number(value: number | null | undefined, digits = 1): string {
	if (!Number.isFinite(value as number)) return "—";
	return (value as number).toFixed(digits);
}

function revenueSeriesLabel(item: {
	dataKey?: string | number;
	payload?: { year?: number; key?: string };
}): string {
	const key = String(item.dataKey ?? "");
	const company = key.startsWith("Anthropic") ? "Anthropic" : "OpenAI";
	const year = item.payload?.year ?? 0;
	const yy = String(year).slice(2);
	const isH1 = (item.payload?.key ?? "").endsWith("H1");
	const isARR = key.endsWith("ARR");
	if (!isARR) return `${company} ${isH1 ? "H1" : "H2"} '${yy}`;
	if (isH1) return `${company} end-H1 '${yy} ARR`;
	return `${company} end-'${yy} ARR`;
}

interface ScenarioButtonProps {
	value: Scenario;
	active: boolean;
	onClick: (value: Scenario) => void;
	label?: string;
}

function ScenarioButton({
	value,
	active,
	onClick,
	label,
}: ScenarioButtonProps) {
	return (
		<Button
			variant={active ? "default" : "outline"}
			className="rounded-2xl capitalize"
			onClick={() => onClick(value)}
		>
			{label ?? value}
		</Button>
	);
}

interface NumberInputProps {
	value: number;
	onChange: (next: number) => void;
	step?: number;
	min?: number;
	disabled?: boolean;
	digits?: number;
}

function NumberInput({
	value,
	onChange,
	step = 0.01,
	min = 0,
	disabled = false,
	digits = 2,
}: NumberInputProps) {
	const [focused, setFocused] = useState(false);
	const v = Number.isFinite(value) ? value : 0;
	const displayValue = focused ? v : Number(v.toFixed(digits));
	return (
		<input
			type="number"
			value={displayValue}
			step={step}
			min={min}
			disabled={disabled}
			onFocus={() => setFocused(true)}
			onBlur={() => setFocused(false)}
			onChange={(e) => {
				const next = Number.parseFloat(e.target.value);
				onChange(Number.isFinite(next) ? next : 0);
			}}
			className={`w-full rounded-md border px-2 py-1 text-right text-sm tabular-nums focus:outline-none ${
				disabled
					? "border-slate-200 bg-slate-100 text-slate-500"
					: "border-slate-200 bg-white focus:border-slate-400"
			}`}
		/>
	);
}

interface MetricCardProps {
	icon: ComponentType<{ className?: string }>;
	label: string;
	value: string;
	sub?: string;
}

function MetricCard({ icon: Icon, label, value, sub }: MetricCardProps) {
	return (
		<Card className="rounded-2xl shadow-sm">
			<CardContent className="p-4">
				<div className="flex items-start justify-between gap-3">
					<div>
						<p className="text-sm text-slate-500">{label}</p>
						<p className="mt-1 text-2xl font-semibold tracking-tight">
							{value}
						</p>
						{sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
					</div>
					<div className="rounded-2xl bg-slate-100 p-2">
						<Icon className="h-5 w-5 text-slate-700" />
					</div>
				</div>
			</CardContent>
		</Card>
	);
}

function DealTable({ companyFilter }: { companyFilter: CompanyFilter }) {
	const rows =
		companyFilter === "All"
			? dealAnchors
			: dealAnchors.filter((d) => d.company === companyFilter);
	return (
		<div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
			<table className="min-w-full text-left text-sm">
				<thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
					<tr>
						<th className="px-4 py-3">Company</th>
						<th className="px-4 py-3">Public anchor</th>
						<th className="px-4 py-3">Reported size / timing</th>
						<th className="px-4 py-3">Model treatment</th>
						<th className="px-4 py-3">Firmness</th>
					</tr>
				</thead>
				<tbody className="divide-y divide-slate-100">
					{rows.map((d) => (
						<tr key={`${d.company}-${d.deal}`} className="align-top">
							<td className="px-4 py-3 font-medium">{d.company}</td>
							<td className="px-4 py-3">
								<a
									className="inline-flex items-center gap-1 font-medium text-slate-900 hover:underline"
									href={d.url}
									target="_blank"
									rel="noreferrer"
								>
									{d.deal}
									<ExternalLink className="h-3 w-3" />
								</a>
							</td>
							<td className="px-4 py-3 text-slate-700">{d.reported}</td>
							<td className="px-4 py-3 text-slate-700">{d.modelUse}</td>
							<td className="px-4 py-3">
								<Badge variant="secondary" className="rounded-full">
									{d.firmness}
								</Badge>
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

function RevenueAnchorTable() {
	return (
		<div className="grid gap-3 md:grid-cols-2">
			{revenueAnchors.map((x) => (
				<Card
					key={`${x.company}-${x.anchor}`}
					className="rounded-2xl shadow-sm"
				>
					<CardContent className="p-4">
						<div className="flex items-center gap-2">
							<Badge
								className="rounded-full"
								variant={x.company === "Anthropic" ? "default" : "secondary"}
							>
								{x.company}
							</Badge>
							<span className="font-semibold">{x.anchor}</span>
						</div>
						<p className="mt-2 text-sm text-slate-700">{x.value}</p>
						{x.url && (
							<a
								href={x.url}
								target="_blank"
								rel="noreferrer"
								className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-slate-900 hover:underline"
							>
								Source <ExternalLink className="h-3 w-3" />
							</a>
						)}
						<p className="mt-2 text-xs text-slate-500">{x.modelUse}</p>
					</CardContent>
				</Card>
			))}
		</div>
	);
}

interface Row {
	period: string;
	key: string;
	year: number;
	AnthropicGW: number;
	OpenAIGW: number;
	AnthropicRevenue: number;
	OpenAIRevenue: number;
	AnthropicGross: number;
	OpenAIGross: number;
	AnthropicNet: number;
	OpenAINet: number;
	AnthropicRevPerGWYear: number | null;
	OpenAIRevPerGWYear: number | null;
}

interface YearAgg {
	AnthropicRevenue: number;
	OpenAIRevenue: number;
	AnthropicAvgGW: number;
	OpenAIAvgGW: number;
	AnthropicRevPerGWYear: number;
	OpenAIRevPerGWYear: number;
}

type CompanyValues = Record<Company, number[]>;

function presetGw(s: Preset): CompanyValues {
	return {
		Anthropic: [...gwAssumptions.Anthropic[s]],
		OpenAI: [...gwAssumptions.OpenAI[s]],
	};
}

function presetGross(): CompanyValues {
	return {
		Anthropic: [
			...grossRevenueHalfYear.Anthropic,
			...initialGrossForecast.Anthropic,
		],
		OpenAI: [...grossRevenueHalfYear.OpenAI, ...initialGrossForecast.OpenAI],
	};
}

export default function ComputeCapacityModel() {
	const [scenario, setScenario] = useState<Scenario>("central");
	const [revenueView, setRevenueView] = useState<RevenueView>("net");
	const [chartRevenueView, setChartRevenueView] = useState<RevenueView>("net");
	const [companyFilter, setCompanyFilter] = useState<CompanyFilter>("All");
	const [anthropicHaircut, setAnthropicHaircut] = useState(20);
	const [openaiHaircut, setOpenaiHaircut] = useState(15);
	const [gwValues, setGwValues] = useState<CompanyValues>(() =>
		presetGw("central"),
	);
	const [grossValues, setGrossValues] = useState<CompanyValues>(() =>
		presetGross(),
	);
	const [forecastMode, setForecastMode] = useState<ForecastMode>("premium");
	const [forecastPremium, setForecastPremium] = useState(1.8);

	function loadPreset(s: Preset) {
		setScenario(s);
		setGwValues(presetGw(s));
		setGrossValues(presetGross());
		setAnthropicHaircut(20);
		setOpenaiHaircut(15);
	}

	const historicalBaselines = useMemo(() => {
		let aNetSum = 0;
		let oNetSum = 0;
		let aGwYears = 0;
		let oGwYears = 0;
		for (let i = 0; i < HISTORICAL_PERIODS; i++) {
			aNetSum += grossValues.Anthropic[i] * (1 - anthropicHaircut / 100);
			oNetSum += grossValues.OpenAI[i] * (1 - openaiHaircut / 100);
			aGwYears += gwValues.Anthropic[i] * 0.5;
			oGwYears += gwValues.OpenAI[i] * 0.5;
		}
		const anthropicNetDpgy = aGwYears > 0 ? aNetSum / aGwYears : 0;
		const openaiNetDpgy = oGwYears > 0 ? oNetSum / oGwYears : 0;
		const totalGwYears = aGwYears + oGwYears;
		const blendedNetDpgy =
			totalGwYears > 0 ? (aNetSum + oNetSum) / totalGwYears : 0;
		return {
			anthropicNetDpgy,
			openaiNetDpgy,
			blendedNetDpgy,
			observedPremium: openaiNetDpgy > 0 ? anthropicNetDpgy / openaiNetDpgy : 0,
		};
	}, [gwValues, grossValues, anthropicHaircut, openaiHaircut]);

	const effectiveGross: CompanyValues = useMemo(() => {
		if (forecastMode === "manual") return grossValues;
		const aHaircutFrac = 1 - anthropicHaircut / 100;
		const oHaircutFrac = 1 - openaiHaircut / 100;
		const anthropic = [...grossValues.Anthropic];
		const openai = [...grossValues.OpenAI];
		for (let i = HISTORICAL_PERIODS; i < PERIODS.length; i++) {
			const aGwYears = gwValues.Anthropic[i] * 0.5;
			const oGwYears = gwValues.OpenAI[i] * 0.5;
			if (forecastMode === "blended") {
				const aNet = historicalBaselines.blendedNetDpgy * aGwYears;
				const oNet = historicalBaselines.blendedNetDpgy * oGwYears;
				anthropic[i] = aHaircutFrac > 0 ? aNet / aHaircutFrac : 0;
				openai[i] = oHaircutFrac > 0 ? oNet / oHaircutFrac : 0;
			} else {
				const oNet = historicalBaselines.openaiNetDpgy * oGwYears;
				const aNet =
					historicalBaselines.openaiNetDpgy * forecastPremium * aGwYears;
				anthropic[i] = aHaircutFrac > 0 ? aNet / aHaircutFrac : 0;
				openai[i] = oHaircutFrac > 0 ? oNet / oHaircutFrac : 0;
			}
		}
		return { Anthropic: anthropic, OpenAI: openai };
	}, [
		forecastMode,
		forecastPremium,
		grossValues,
		gwValues,
		anthropicHaircut,
		openaiHaircut,
		historicalBaselines,
	]);

	function updateGw(company: Company, i: number, value: number) {
		setGwValues((prev) => {
			const next = { ...prev, [company]: [...prev[company]] };
			next[company][i] = value;
			return next;
		});
		setScenario("custom");
	}

	function updateGross(company: Company, i: number, value: number) {
		setGrossValues((prev) => {
			const next = { ...prev, [company]: [...prev[company]] };
			next[company][i] = value;
			return next;
		});
		setScenario("custom");
	}

	function rescaleGrossForHaircut(
		company: Company,
		oldHaircut: number,
		newHaircut: number,
	) {
		const oldFrac = 1 - oldHaircut / 100;
		const newFrac = 1 - newHaircut / 100;
		if (newFrac <= 0) return;
		const ratio = oldFrac / newFrac;
		setGrossValues((prev) => ({
			...prev,
			[company]: prev[company].map((g) => g * ratio),
		}));
	}

	const rows: Row[] = useMemo(() => {
		return PERIODS.map((p, i) => {
			const agw = gwValues.Anthropic[i];
			const ogw = gwValues.OpenAI[i];
			const aGross = effectiveGross.Anthropic[i];
			const oGross = effectiveGross.OpenAI[i];
			const aNet = aGross * (1 - anthropicHaircut / 100);
			const oNet = oGross * (1 - openaiHaircut / 100);
			const aRev = revenueView === "gross" ? aGross : aNet;
			const oRev = revenueView === "gross" ? oGross : oNet;
			return {
				period: p.label,
				key: p.key,
				year: p.year,
				AnthropicGW: agw,
				OpenAIGW: ogw,
				AnthropicRevenue: aRev,
				OpenAIRevenue: oRev,
				AnthropicGross: aGross,
				OpenAIGross: oGross,
				AnthropicNet: aNet,
				OpenAINet: oNet,
				AnthropicRevPerGWYear: agw > 0 ? aRev / (agw * 0.5) : null,
				OpenAIRevPerGWYear: ogw > 0 ? oRev / (ogw * 0.5) : null,
			};
		});
	}, [gwValues, effectiveGross, revenueView, anthropicHaircut, openaiHaircut]);

	const revenueChartData = useMemo(() => {
		const baseRows = rows.map((r) => {
			const aRev =
				chartRevenueView === "gross" ? r.AnthropicGross : r.AnthropicNet;
			const oRev = chartRevenueView === "gross" ? r.OpenAIGross : r.OpenAINet;
			return { ...r, AnthropicRevenue: aRev, OpenAIRevenue: oRev };
		});

		const lastIdx = PERIODS.length - 1;
		const prevIdx = lastIdx - 1;
		const aHaircutFrac = 1 - anthropicHaircut / 100;
		const oHaircutFrac = 1 - openaiHaircut / 100;
		const aH1_28_gw =
			2 * gwValues.Anthropic[lastIdx] - gwValues.Anthropic[prevIdx];
		const oH1_28_gw = 2 * gwValues.OpenAI[lastIdx] - gwValues.OpenAI[prevIdx];
		const aH1_28_gwYears = aH1_28_gw * 0.5;
		const oH1_28_gwYears = oH1_28_gw * 0.5;
		let aH1_28_net: number;
		let oH1_28_net: number;
		if (forecastMode === "blended") {
			aH1_28_net = historicalBaselines.blendedNetDpgy * aH1_28_gwYears;
			oH1_28_net = historicalBaselines.blendedNetDpgy * oH1_28_gwYears;
		} else if (forecastMode === "premium") {
			aH1_28_net =
				historicalBaselines.openaiNetDpgy * forecastPremium * aH1_28_gwYears;
			oH1_28_net = historicalBaselines.openaiNetDpgy * oH1_28_gwYears;
		} else {
			const aLastGwYears = gwValues.Anthropic[lastIdx] * 0.5;
			const oLastGwYears = gwValues.OpenAI[lastIdx] * 0.5;
			const aDpgy =
				aLastGwYears > 0
					? (effectiveGross.Anthropic[lastIdx] * aHaircutFrac) / aLastGwYears
					: 0;
			const oDpgy =
				oLastGwYears > 0
					? (effectiveGross.OpenAI[lastIdx] * oHaircutFrac) / oLastGwYears
					: 0;
			aH1_28_net = aDpgy * aH1_28_gwYears;
			oH1_28_net = oDpgy * oH1_28_gwYears;
		}
		const aH1_28_gross = aHaircutFrac > 0 ? aH1_28_net / aHaircutFrac : 0;
		const oH1_28_gross = oHaircutFrac > 0 ? oH1_28_net / oHaircutFrac : 0;
		const aH1_28_rev = chartRevenueView === "gross" ? aH1_28_gross : aH1_28_net;
		const oH1_28_rev = chartRevenueView === "gross" ? oH1_28_gross : oH1_28_net;

		return baseRows.map((r, i) => {
			const next = baseRows[i + 1];
			if (next) {
				return {
					...r,
					AnthropicARR: r.AnthropicRevenue + next.AnthropicRevenue,
					OpenAIARR: r.OpenAIRevenue + next.OpenAIRevenue,
				};
			}
			return {
				...r,
				AnthropicARR:
					2 * Math.sqrt(Math.max(0, r.AnthropicRevenue * aH1_28_rev)),
				OpenAIARR: 2 * Math.sqrt(Math.max(0, r.OpenAIRevenue * oH1_28_rev)),
			};
		});
	}, [
		rows,
		chartRevenueView,
		gwValues,
		effectiveGross,
		forecastMode,
		forecastPremium,
		anthropicHaircut,
		openaiHaircut,
		historicalBaselines,
	]);

	const fy: Record<number, YearAgg> = useMemo(() => {
		const out: Record<number, YearAgg> = {};
		for (const year of [2024, 2025, 2026, 2027]) {
			const yr = rows.filter((r) => r.year === year);
			const AnthropicRevenue = yr.reduce((s, r) => s + r.AnthropicRevenue, 0);
			const OpenAIRevenue = yr.reduce((s, r) => s + r.OpenAIRevenue, 0);
			const AnthropicAvgGW = yr.reduce((s, r) => s + r.AnthropicGW, 0) / 2;
			const OpenAIAvgGW = yr.reduce((s, r) => s + r.OpenAIGW, 0) / 2;
			out[year] = {
				AnthropicRevenue,
				OpenAIRevenue,
				AnthropicAvgGW,
				OpenAIAvgGW,
				AnthropicRevPerGWYear: AnthropicRevenue / AnthropicAvgGW,
				OpenAIRevPerGWYear: OpenAIRevenue / OpenAIAvgGW,
			};
		}
		return out;
	}, [rows]);

	const last = rows[rows.length - 1];
	const premium2027 =
		fy[2027].AnthropicRevPerGWYear / fy[2027].OpenAIRevPerGWYear;
	const selectedRevenueLabel =
		revenueView === "gross" ? "gross / reported-style" : "net-retained";

	return (
		<div className="min-h-screen bg-slate-50 p-4 text-slate-950 md:p-8">
			<div className="mx-auto max-w-7xl space-y-6">
				<header className="rounded-3xl bg-white p-6 shadow-sm md:p-8">
					<div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-4">
						<div className="flex flex-wrap gap-2">
							<Badge className="rounded-full">AI compute model</Badge>
							<Badge variant="secondary" className="rounded-full">
								Updated May 2026
							</Badge>
							<Badge variant="outline" className="rounded-full">
								Units: average usable AI GW
							</Badge>
						</div>
						<div className="flex shrink-0 flex-wrap gap-2 md:justify-end">
							{PRESETS.map((s) => (
								<ScenarioButton
									key={s}
									value={s}
									active={scenario === s}
									onClick={loadPreset}
								/>
							))}
							<Button
								variant={scenario === "custom" ? "default" : "outline"}
								className="rounded-2xl capitalize"
								disabled={scenario !== "custom"}
								aria-pressed={scenario === "custom"}
							>
								custom
							</Button>
						</div>
					</div>
					<h1 className="mt-4 text-3xl font-semibold tracking-tight md:text-5xl">
						Anthropic vs. OpenAI revenue headroom from committed compute
					</h1>
					<p className="mt-4 text-sm leading-6 text-slate-600 md:text-base">
						GW of usable AI compute is a hard ceiling on revenue: every dollar
						booked has to be served from somewhere. This model takes public deal
						anchors as a forward GW supply curve, divides reported (or
						net-retained) revenue by that curve, and asks whether the implied
						$/GW-year is plausible. Headline run-rate numbers that imply a
						$/GW-year far above peers are either evidence of premium
						monetization, gross-of-channel accounting, or undercounted capacity
						— the controls below let you stress each.
					</p>
				</header>

				<Card className="rounded-3xl shadow-sm">
					<CardContent className="p-0">
						<details className="group">
							<summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-5 md:p-6">
								<div>
									<h2 className="flex items-center gap-2 text-xl font-semibold">
										<span
											className="inline-block transition-transform group-open:rotate-90"
											aria-hidden
										>
											▶
										</span>
										Assumptions
										<Badge
											variant="outline"
											className="rounded-full capitalize"
										>
											{scenario}
										</Badge>
									</h2>
									<p className="mt-1 text-sm text-slate-500">
										GW values are average usable AI gigawatts for each
										half-year; gross revenue is reported-style dollars in $B.
									</p>
								</div>
								<div className="flex flex-wrap items-center gap-2">
									<Button
										variant={revenueView === "net" ? "default" : "outline"}
										className="rounded-2xl"
										onClick={(e) => {
											e.preventDefault();
											setRevenueView("net");
										}}
									>
										Net retained
									</Button>
									<Button
										variant={revenueView === "gross" ? "default" : "outline"}
										className="rounded-2xl"
										onClick={(e) => {
											e.preventDefault();
											setRevenueView("gross");
										}}
									>
										Gross
									</Button>
								</div>
							</summary>
							<div className="space-y-5 px-5 pb-5 md:px-6 md:pb-6">
								<div className="overflow-x-auto rounded-2xl border border-slate-200">
									<table className="min-w-full text-sm">
										<thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
											<tr>
												<th
													rowSpan={2}
													className="px-3 py-2 text-left align-bottom"
												>
													Period
												</th>
												<th
													colSpan={2}
													className="border-l border-slate-200 px-3 py-2 text-center"
												>
													Average usable GW
												</th>
												<th
													colSpan={2}
													className="border-l border-slate-200 px-3 py-2 text-center"
												>
													{revenueView === "gross" ? "Gross" : "Net-retained"}{" "}
													half-year revenue ($B)
												</th>
												<th
													colSpan={2}
													className="border-l border-slate-200 px-3 py-2 text-center"
												>
													Implied {revenueView === "gross" ? "gross" : "net"}{" "}
													$/GW-year ($B)
												</th>
											</tr>
											<tr>
												<th className="border-l border-slate-200 px-3 py-2 text-right font-medium">
													Anthropic
												</th>
												<th className="px-3 py-2 text-right font-medium">
													OpenAI
												</th>
												<th className="border-l border-slate-200 px-3 py-2 text-right font-medium">
													Anthropic
												</th>
												<th className="px-3 py-2 text-right font-medium">
													OpenAI
												</th>
												<th className="border-l border-slate-200 px-3 py-2 text-right font-medium">
													Anthropic
												</th>
												<th className="px-3 py-2 text-right font-medium">
													OpenAI
												</th>
											</tr>
										</thead>
										<tbody className="divide-y divide-slate-100 bg-white">
											{PERIODS.map((p, i) => {
												const aGw = gwValues.Anthropic[i];
												const oGw = gwValues.OpenAI[i];
												const aHaircutFrac = 1 - anthropicHaircut / 100;
												const oHaircutFrac = 1 - openaiHaircut / 100;
												const aDisplayedRevenue =
													revenueView === "gross"
														? effectiveGross.Anthropic[i]
														: effectiveGross.Anthropic[i] * aHaircutFrac;
												const oDisplayedRevenue =
													revenueView === "gross"
														? effectiveGross.OpenAI[i]
														: effectiveGross.OpenAI[i] * oHaircutFrac;
												const aDpgy =
													aGw > 0 ? aDisplayedRevenue / (aGw * 0.5) : 0;
												const oDpgy =
													oGw > 0 ? oDisplayedRevenue / (oGw * 0.5) : 0;
												const handleAnthropicRevenue = (v: number) => {
													updateGross(
														"Anthropic",
														i,
														revenueView === "gross"
															? v
															: aHaircutFrac > 0
																? v / aHaircutFrac
																: 0,
													);
												};
												const handleOpenAIRevenue = (v: number) => {
													updateGross(
														"OpenAI",
														i,
														revenueView === "gross"
															? v
															: oHaircutFrac > 0
																? v / oHaircutFrac
																: 0,
													);
												};
												return (
													<tr key={p.key}>
														<td className="px-3 py-2 font-medium text-slate-700">
															{p.label}
														</td>
														<td className="w-28 border-l border-slate-200 px-2 py-1.5">
															<NumberInput
																value={aGw}
																onChange={(v) => updateGw("Anthropic", i, v)}
															/>
														</td>
														<td className="w-28 px-2 py-1.5">
															<NumberInput
																value={oGw}
																onChange={(v) => updateGw("OpenAI", i, v)}
															/>
														</td>
														<td className="w-28 border-l border-slate-200 px-2 py-1.5">
															<NumberInput
																value={aDisplayedRevenue}
																onChange={handleAnthropicRevenue}
																step={0.1}
																disabled={
																	forecastMode !== "manual" &&
																	i >= HISTORICAL_PERIODS
																}
															/>
														</td>
														<td className="w-28 px-2 py-1.5">
															<NumberInput
																value={oDisplayedRevenue}
																onChange={handleOpenAIRevenue}
																step={0.1}
																disabled={
																	forecastMode !== "manual" &&
																	i >= HISTORICAL_PERIODS
																}
															/>
														</td>
														<td className="w-28 border-l border-slate-200 px-3 py-2 text-right tabular-nums text-slate-600">
															{number(aDpgy, 2)}
														</td>
														<td className="w-28 px-3 py-2 text-right tabular-nums text-slate-600">
															{number(oDpgy, 2)}
														</td>
													</tr>
												);
											})}
										</tbody>
									</table>
								</div>

								<div className="grid gap-4 md:grid-cols-2">
									<div className="space-y-3 rounded-2xl border border-slate-200 p-4">
										<div className="flex items-center justify-between">
											<span className="font-medium">
												Anthropic cloud/channel haircut
											</span>
											<span className="text-sm font-semibold">
												{anthropicHaircut}%
											</span>
										</div>
										<Slider
											value={[anthropicHaircut]}
											min={0}
											max={40}
											step={1}
											onValueChange={(v) => {
												if (revenueView === "net") {
													rescaleGrossForHaircut(
														"Anthropic",
														anthropicHaircut,
														v[0],
													);
												}
												setAnthropicHaircut(v[0]);
												setScenario("custom");
											}}
										/>
										<p className="text-xs text-slate-500">
											Default reflects gross reporting concern for
											AWS/Google-distributed Claude revenue.
										</p>
									</div>
									<div className="space-y-3 rounded-2xl border border-slate-200 p-4">
										<div className="flex items-center justify-between">
											<span className="font-medium">
												OpenAI revenue-share haircut
											</span>
											<span className="text-sm font-semibold">
												{openaiHaircut}%
											</span>
										</div>
										<Slider
											value={[openaiHaircut]}
											min={0}
											max={35}
											step={1}
											onValueChange={(v) => {
												if (revenueView === "net") {
													rescaleGrossForHaircut("OpenAI", openaiHaircut, v[0]);
												}
												setOpenaiHaircut(v[0]);
												setScenario("custom");
											}}
										/>
										<p className="text-xs text-slate-500">
											Default reflects Microsoft economics and non-retained
											platform revenue.
										</p>
									</div>
								</div>

								<div className="rounded-2xl bg-slate-100 p-4 text-sm text-slate-700">
									<div className="mb-2 flex items-center gap-2 font-semibold text-slate-900">
										<Info className="h-4 w-4" /> Model caveat
									</div>
									The output is most useful directionally. The biggest open
									variable is whether Anthropic's reported revenue is
									overstating end-demand due to gross cloud accounting, or
									whether our GW denominator undercounts TPU/cloud capacity.
								</div>
							</div>
						</details>
					</CardContent>
				</Card>

				<Card className="rounded-3xl shadow-sm">
					<CardContent className="space-y-4 p-5 md:p-6">
						<div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
							<div>
								<h2 className="text-xl font-semibold">
									Forecast $/GW methodology
								</h2>
								<p className="mt-1 text-sm text-slate-500">
									Two ways to think about projecting revenue from 2026H2 onward.
									Historical periods (2024–2025) remain as observed.
								</p>
							</div>
							<div className="flex flex-wrap gap-2">
								<Button
									variant={forecastMode === "manual" ? "default" : "outline"}
									className="rounded-2xl"
									onClick={() => setForecastMode("manual")}
								>
									Manual
								</Button>
								<Button
									variant={forecastMode === "blended" ? "default" : "outline"}
									className="rounded-2xl"
									onClick={() => setForecastMode("blended")}
								>
									Blended baseline
								</Button>
								<Button
									variant={forecastMode === "premium" ? "default" : "outline"}
									className="rounded-2xl"
									onClick={() => setForecastMode("premium")}
								>
									Anthropic premium
								</Button>
							</div>
						</div>

						<div className="grid gap-3 md:grid-cols-2">
							<button
								type="button"
								aria-pressed={forecastMode === "blended"}
								onClick={() => setForecastMode("blended")}
								className={`rounded-2xl border p-4 text-left text-sm transition hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400 ${
									forecastMode === "blended"
										? "border-slate-900 bg-slate-50"
										: "border-slate-200 bg-white"
								}`}
							>
								<div className="mb-1 font-semibold">
									1. Blended historical $/GW
								</div>
								<p className="text-slate-700">
									Pool 2024–2025 net-retained revenue across both companies and
									divide by total GW-years to get a single $/GW-year. Forecast
									revenue for each company is just that baseline × their
									forecast GW. Assumes Anthropic and OpenAI converge on the same
									monetization per unit of compute.
								</p>
								<p className="mt-2 text-xs text-slate-500">
									Current blended baseline:{" "}
									<span className="font-semibold text-slate-700">
										{currency(historicalBaselines.blendedNetDpgy)}/GW-year
									</span>
									.
								</p>
							</button>
							<button
								type="button"
								aria-pressed={forecastMode === "premium"}
								onClick={() => setForecastMode("premium")}
								className={`rounded-2xl border p-4 text-left text-sm transition hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400 ${
									forecastMode === "premium"
										? "border-slate-900 bg-slate-50"
										: "border-slate-200 bg-white"
								}`}
							>
								<div className="mb-1 font-semibold">
									2. Anthropic premium over OpenAI
								</div>
								<p className="text-slate-700">
									Historical data shows Anthropic earning meaningfully more per
									GW than OpenAI even after the net-retained haircut —
									reflecting enterprise/API mix vs consumer/free. This mode
									anchors the forecast on OpenAI's historical $/GW and lets you
									set the Anthropic premium directly.
								</p>
								<p className="mt-2 text-xs text-slate-500">
									Observed historical premium:{" "}
									<span className="font-semibold text-slate-700">
										{number(historicalBaselines.observedPremium, 2)}×
									</span>
									. OpenAI historical baseline:{" "}
									<span className="font-semibold text-slate-700">
										{currency(historicalBaselines.openaiNetDpgy)}/GW-year
									</span>
									.
								</p>
							</button>
						</div>

						{forecastMode === "premium" && (
							<div className="space-y-3 rounded-2xl border border-slate-200 p-4">
								<div className="flex items-center justify-between">
									<span className="font-medium">
										Forecast Anthropic $/GW premium
									</span>
									<span className="text-sm font-semibold">
										{forecastPremium.toFixed(2)}×
									</span>
								</div>
								<Slider
									value={[forecastPremium]}
									min={1}
									max={3}
									step={0.05}
									onValueChange={(v) => setForecastPremium(v[0])}
								/>
								<p className="text-xs text-slate-500">
									1.0× means Anthropic and OpenAI earn the same net-retained
									dollars per GW in the forecast. Higher values bake in durable
									enterprise/API premium.
								</p>
							</div>
						)}

						{forecastMode !== "manual" && (
							<p className="text-xs text-slate-500">
								Forecast revenue inputs above are derived and read-only in this
								mode. Adjust haircuts or GW assumptions to change them, or
								switch back to Manual to edit revenue directly.
							</p>
						)}
					</CardContent>
				</Card>

				<section className="grid gap-4 md:grid-cols-4">
					<MetricCard
						icon={Zap}
						label="Anthropic H2 2027 avg GW"
						value={`${number(last.AnthropicGW)} GW`}
						sub={`${scenario} scenario`}
					/>
					<MetricCard
						icon={Zap}
						label="OpenAI H2 2027 avg GW"
						value={`${number(last.OpenAIGW)} GW`}
						sub={`${scenario} scenario`}
					/>
					<MetricCard
						icon={DollarSign}
						label={`Anthropic FY2027 ${selectedRevenueLabel}`}
						value={currency(fy[2027].AnthropicRevenue)}
						sub={`haircut: ${anthropicHaircut}%`}
					/>
					<MetricCard
						icon={Gauge}
						label="Anthropic $/GW premium in 2027"
						value={`${number(premium2027, 2)}×`}
						sub={`vs OpenAI, ${selectedRevenueLabel}`}
					/>
				</section>

				<Card className="rounded-3xl shadow-sm">
					<CardContent className="p-5">
						<div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
							<div>
								<h2 className="text-xl font-semibold">
									Half-year revenue implied by scenario
								</h2>
								<p className="text-sm text-slate-500">
									Revenue is recognized dollars for the half-year, not exit ARR.
									Shaded region marks projected periods.
								</p>
							</div>
							<div className="flex flex-wrap items-center gap-2">
								<Button
									variant={chartRevenueView === "net" ? "default" : "outline"}
									className="rounded-2xl"
									onClick={() => setChartRevenueView("net")}
								>
									Net retained
								</Button>
								<Button
									variant={chartRevenueView === "gross" ? "default" : "outline"}
									className="rounded-2xl"
									onClick={() => setChartRevenueView("gross")}
								>
									Gross
								</Button>
							</div>
						</div>
						<div className="h-80">
							<ResponsiveContainer width="100%" height="100%">
								<ComposedChart
									data={revenueChartData}
									margin={{ top: 10, right: 24, left: 0, bottom: 0 }}
								>
									<CartesianGrid strokeDasharray="3 3" />
									<XAxis dataKey="period" />
									<YAxis tickFormatter={(v) => `$${v}B`} />
									<ReferenceArea
										x1="H1 2026"
										x2="H2 2027"
										fill="#94a3b8"
										fillOpacity={0.15}
										ifOverflow="extendDomain"
									/>
									<Tooltip
										formatter={(value, _name, item) => [
											currency(Number(value)),
											revenueSeriesLabel(item),
										]}
										itemSorter={(item) => -Number(item.value)}
									/>
									<Legend />
									<Bar
										dataKey="AnthropicRevenue"
										name="Anthropic half-year"
										fill="#0f766e"
										radius={[8, 8, 0, 0]}
									/>
									<Bar
										dataKey="OpenAIRevenue"
										name="OpenAI half-year"
										fill="#2563eb"
										radius={[8, 8, 0, 0]}
									/>
									<Line
										type="monotone"
										dataKey="AnthropicARR"
										name="Anthropic end-of-half ARR"
										stroke="#0f766e"
										strokeWidth={2}
										strokeDasharray="6 4"
										dot={{ r: 4 }}
									/>
									<Line
										type="monotone"
										dataKey="OpenAIARR"
										name="OpenAI end-of-half ARR"
										stroke="#2563eb"
										strokeWidth={2}
										strokeDasharray="6 4"
										dot={{ r: 4 }}
									/>
								</ComposedChart>
							</ResponsiveContainer>
						</div>
					</CardContent>
				</Card>

				<section className="grid gap-4 lg:grid-cols-2">
					<Card className="rounded-3xl shadow-sm">
						<CardContent className="p-5">
							<div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
								<div>
									<h2 className="text-xl font-semibold">
										Average usable AI GW by half-year
									</h2>
									<p className="text-sm text-slate-500">
										Central interpretation: usable revenue-serving +
										training-capable capacity, not headline contracted GW.
									</p>
								</div>
								<Badge
									variant="outline"
									className="w-fit rounded-full capitalize"
								>
									{scenario}
								</Badge>
							</div>
							<div className="h-80">
								<ResponsiveContainer width="100%" height="100%">
									<LineChart
										data={rows}
										margin={{ top: 10, right: 24, left: 0, bottom: 0 }}
									>
										<CartesianGrid strokeDasharray="3 3" />
										<XAxis dataKey="period" />
										<YAxis unit=" GW" />
										<Tooltip
											formatter={(value, name) => [
												`${Number(value).toFixed(2)} GW`,
												name as string,
											]}
											itemSorter={(item) => -Number(item.value)}
										/>
										<Legend />
										<Line
											type="monotone"
											dataKey="AnthropicGW"
											name="Anthropic"
											stroke="#0f766e"
											strokeWidth={3}
											dot={{ r: 3 }}
										/>
										<Line
											type="monotone"
											dataKey="OpenAIGW"
											name="OpenAI"
											stroke="#2563eb"
											strokeWidth={3}
											dot={{ r: 3 }}
										/>
									</LineChart>
								</ResponsiveContainer>
							</div>
						</CardContent>
					</Card>

					<Card className="rounded-3xl shadow-sm">
						<CardContent className="p-5">
							<div className="mb-4">
								<h2 className="text-xl font-semibold">
									Implied revenue per average GW-year
								</h2>
								<p className="text-sm text-slate-500">
									Revenue divided by average usable GW. This is the key sanity
									check.
								</p>
							</div>
							<div className="overflow-x-auto rounded-2xl border border-slate-200">
								<table className="min-w-full text-sm">
									<thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
										<tr>
											<th className="px-4 py-3">Year</th>
											<th className="px-4 py-3 text-right">Anthropic avg GW</th>
											<th className="px-4 py-3 text-right">OpenAI avg GW</th>
											<th className="px-4 py-3 text-right">
												Anthropic $/GW-year
											</th>
											<th className="px-4 py-3 text-right">OpenAI $/GW-year</th>
											<th className="px-4 py-3 text-right">Premium</th>
										</tr>
									</thead>
									<tbody className="divide-y divide-slate-100 bg-white">
										{[2024, 2025, 2026, 2027].map((year) => (
											<tr key={year}>
												<td className="px-4 py-3 font-medium">{year}</td>
												<td className="px-4 py-3 text-right">
													{number(fy[year].AnthropicAvgGW, 2)}
												</td>
												<td className="px-4 py-3 text-right">
													{number(fy[year].OpenAIAvgGW, 2)}
												</td>
												<td className="px-4 py-3 text-right">
													{currency(fy[year].AnthropicRevPerGWYear)}
												</td>
												<td className="px-4 py-3 text-right">
													{currency(fy[year].OpenAIRevPerGWYear)}
												</td>
												<td className="px-4 py-3 text-right font-semibold">
													{number(
														fy[year].AnthropicRevPerGWYear /
															fy[year].OpenAIRevPerGWYear,
														2,
													)}
													×
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
							<p className="mt-3 text-xs text-slate-500">
								Interpretation: accounting haircuts shrink, but do not
								eliminate, Anthropic's apparent revenue/GW premium in the
								central case.
							</p>
						</CardContent>
					</Card>
				</section>

				<section className="space-y-4">
					<div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
						<div>
							<h2 className="text-2xl font-semibold">
								Public-source deal anchors encoded in the model
							</h2>
							<p className="text-sm text-slate-500">
								These are not all additive; some are overlapping, staged,
								non-binding, or post-2027-heavy.
							</p>
						</div>
						<div className="flex gap-2">
							{(["All", "Anthropic", "OpenAI"] as CompanyFilter[]).map((x) => (
								<Button
									key={x}
									variant={companyFilter === x ? "default" : "outline"}
									className="rounded-2xl"
									onClick={() => setCompanyFilter(x)}
								>
									{x}
								</Button>
							))}
						</div>
					</div>
					<DealTable companyFilter={companyFilter} />
				</section>

				<section className="space-y-4 pb-10">
					<h2 className="text-2xl font-semibold">Revenue/accounting anchors</h2>
					<RevenueAnchorTable />
				</section>
			</div>
		</div>
	);
}
