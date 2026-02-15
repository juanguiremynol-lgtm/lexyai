/**
 * DemoRadicadoSection — "Prueba Andro IA" on landing page.
 * Now delegates to DemoLookupWidget for reuse.
 */

import { DemoLookupWidget } from "./DemoLookupWidget";

export function DemoRadicadoSection() {
  return (
    <section
      id="demo"
      className="py-20 md:py-28 bg-gradient-to-b from-muted/30 via-muted/50 to-muted/30"
    >
      <DemoLookupWidget
        variant="full"
        frame="androMouth"
        ctaMode="none"
      />
    </section>
  );
}
