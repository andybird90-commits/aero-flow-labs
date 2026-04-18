import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { FileText, FileSpreadsheet, Box, Image as ImageIcon, Download, Check } from "lucide-react";

const exports = [
  { type: "PDF Report", icon: FileText, name: "AeroLab_CivicFK8_VariantB.pdf", size: "4.2 MB", date: "today, 14:08", checked: true },
  { type: "CSV Dataset", icon: FileSpreadsheet, name: "run_2184_forces.csv", size: "82 KB", date: "today, 14:09", checked: true },
  { type: "STL · Aero pack", icon: Box, name: "variant_b_aero_package.zip", size: "11.4 MB", date: "yesterday", checked: false },
  { type: "Pressure plots", icon: ImageIcon, name: "cp_distribution_pack.png", size: "2.1 MB", date: "yesterday", checked: false },
];

const Exports = () => {
  return (
    <AppLayout>
      <div className="mx-auto max-w-7xl px-6 py-8">
        <PageHeader
          eyebrow="Library"
          title="Exports & Reports"
          description="Download engineering reports, raw datasets and STL packages of approved aero configurations."
          actions={
            <Button size="sm" className="bg-gradient-primary text-primary-foreground shadow-glow">
              <Download className="mr-2 h-3.5 w-3.5" /> Export current run
            </Button>
          }
        />

        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2 glass rounded-lg overflow-hidden">
            <div className="border-b border-border px-5 py-3 flex items-center justify-between">
              <div className="text-mono text-[10px] uppercase tracking-widest text-primary/80">Recent artifacts</div>
              <div className="text-mono text-[11px] text-muted-foreground">4 files · 17.7 MB</div>
            </div>
            <div className="divide-y divide-border">
              {exports.map((e) => (
                <div key={e.name} className="flex items-center gap-4 px-5 py-3.5 hover:bg-surface-2/40 transition-colors">
                  <div className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-surface-1">
                    <e.icon className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{e.name}</div>
                    <div className="text-mono text-[11px] text-muted-foreground">{e.type} · {e.size} · {e.date}</div>
                  </div>
                  {e.checked && (
                    <span className="text-mono text-[10px] uppercase tracking-widest rounded border border-success/30 bg-success/10 px-2 py-0.5 text-success inline-flex items-center gap-1">
                      <Check className="h-3 w-3" /> Approved
                    </span>
                  )}
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary">
                    <Download className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <div className="glass rounded-lg p-5">
              <div className="text-mono text-[10px] uppercase tracking-widest text-primary/80">Report builder</div>
              <p className="mt-2 text-xs text-muted-foreground">
                Generate a PDF engineering report including all selected variants, plots and assumptions.
              </p>
              <div className="mt-4 space-y-2 text-xs">
                {["Cover & build summary", "Operating conditions", "Force breakdown", "Pressure & velocity plots", "Assumptions & confidence", "Appendix: solver log"].map((s, i) => (
                  <label key={s} className="flex items-center gap-2.5">
                    <input type="checkbox" defaultChecked={i < 5} className="h-3.5 w-3.5 rounded border-border bg-surface-1 accent-primary" />
                    <span className="text-foreground/90">{s}</span>
                  </label>
                ))}
              </div>
              <Button size="sm" className="mt-4 w-full bg-gradient-primary text-primary-foreground">
                Generate PDF
              </Button>
            </div>

            <div className="rounded-lg border border-border bg-surface-1 p-4 text-xs">
              <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Disclaimer</div>
              <p className="text-muted-foreground leading-relaxed">
                Outputs are for <span className="text-foreground">comparative aero development</span>.
                Not suitable for OEM homologation or wind-tunnel correlation without calibration.
              </p>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default Exports;
