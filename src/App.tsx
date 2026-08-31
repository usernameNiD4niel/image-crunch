import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";

// No QueryClientProvider, TooltipProvider or <Toaster />: this app makes no
// network requests by design, renders no tooltips, and calls toast() nowhere.
// They were Lovable scaffolding, and the react-query/sonner/next-themes deps
// they kept alive have been dropped with them.
const App = () => (
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<Index />} />
      {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
      <Route path="*" element={<NotFound />} />
    </Routes>
  </BrowserRouter>
);

export default App;
