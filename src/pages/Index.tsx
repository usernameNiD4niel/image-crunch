import { Masthead } from "@/components/Masthead";
import { Statement } from "@/components/Statement";
import { useQueue } from "@/hooks/useQueue";

const Index = () => {
  const { items, totals, downloadAll } = useQueue();
  const working = items.filter((i) => i.status === "working").length;

  return (
    <>
      <Masthead count={items.length} working={working} totals={totals} onDownloadAll={downloadAll} />
      <Statement />
      <main id="tool" className="mx-auto max-w-[1440px] border-t border-rule px-6 py-16" />
    </>
  );
};

export default Index;
