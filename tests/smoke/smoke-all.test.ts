/*
 * smoke-all.test.ts
 *
 * Copyright (C) 2022 by RStudio, PBC
 *
 */

import { expandGlobSync } from "fs/mod.ts";
import { testQuartoCmd, Verify } from "../test.ts";

import { initYamlIntelligenceResourcesFromFilesystem } from "../../src/core/schema/utils.ts";
import {
  initState,
  setInitializer,
} from "../../src/core/lib/yaml-validation/state.ts";

import { breakQuartoMd } from "../../src/core/lib/break-quarto-md.ts";
import { parse } from "encoding/yaml.ts";
import { cleanoutput } from "./render/render.ts";
import {
  ensureDocxRegexMatches,
  ensureFileRegexMatches,
  ensureHtmlElements,
  noErrors,
  noErrorsOrWarnings,
} from "../verify.ts";
import { readYamlFromMarkdown } from "../../src/core/yaml.ts";
import { outputForInput } from "../utils.ts";

async function fullInit() {
  await initYamlIntelligenceResourcesFromFilesystem();
}

async function guessFormat(fileName: string): Promise<string[]> {
  const { cells } = await breakQuartoMd(Deno.readTextFileSync(fileName));

  const formats: Set<string> = new Set();

  for (const cell of cells) {
    if (cell.cell_type === "raw") {
      const src = cell.source.value.replaceAll(/^---$/mg, "");
      const yaml = parse(src);
      if (yaml && typeof yaml === "object") {
        const format = (yaml as Record<string, any>).format;
        if (typeof format === "object") {
          for (
            const [k, _] of Object.entries(
              // deno-lint-ignore no-explicit-any
              (yaml as Record<string, any>).format || {},
            )
          ) {
            formats.add(k);
          }
        } else if (typeof format === "string") {
          formats.add(format);
        }
      }
    }
  }
  return Array.from(formats);
}

//deno-lint-ignore no-explicit-any
function hasTestSpecs(metadata: any): boolean {
  return metadata?.["_quarto"]?.["tests"] != undefined;
}

interface QuartoInlineTestSpec {
  format: string;
  verifyFns: Verify[];
}

function resolveTestSpecs(
  input: string,
  // deno-lint-ignore no-explicit-any
  metadata: Record<string, any>,
): QuartoInlineTestSpec[] {
  const specs = metadata["_quarto"]["tests"];

  const result = [];
  // deno-lint-ignore no-explicit-any
  const verifyMap: Record<string, any> = {
    ensureHtmlElements,
    ensureFileRegexMatches,
    ensureDocxRegexMatches,
  };

  for (const [format, testObj] of Object.entries(specs)) {
    let checkWarnings = true;
    const verifyFns: Verify[] = [];
    if (testObj) {
      for (
        // deno-lint-ignore no-explicit-any
        const [key, value] of Object.entries(testObj as Record<string, any>)
      ) {
        if (key === "noErrors") {
          console.log("NO ERRORS!!!");
          checkWarnings = false;
          verifyFns.push(noErrors);
        } else {
          if (verifyMap[key]) {
            const outputFile = outputForInput(input, format);
            verifyFns.push(verifyMap[key](outputFile.outputPath, ...value));
          }
        }
      }
    }
    if (checkWarnings) {
      console.log("added no errors or warnings");
      verifyFns.push(noErrorsOrWarnings);
    }

    result.push({
      format,
      verifyFns,
    });
  }
  return result;
}

const globOutput = Deno.args.length
  ? expandGlobSync(Deno.args[0])
  : expandGlobSync(
    "docs/smoke-all/**/*.qmd",
  );

for (
  const { path: fileName } of globOutput
) {
  const input = fileName;

  const metadata = readYamlFromMarkdown(Deno.readTextFileSync(input));
  const testSpecs = [];

  if (hasTestSpecs(metadata)) {
    testSpecs.push(...resolveTestSpecs(input, metadata));
  } else {
    const formats = await guessFormat(input);

    if (formats.length == 0) {
      formats.push("html");
    }
    for (const format of formats) {
      testSpecs.push({ format: format, verifyFns: [noErrorsOrWarnings] });
    }
  }

  for (const testSpec of testSpecs) {
    const {
      format,
      verifyFns,
      //deno-lint-ignore no-explicit-any
    } = testSpec as any;

    testQuartoCmd("render", [input, "--to", format], verifyFns, {
      prereq: async () => {
        setInitializer(fullInit);
        await initState();
        return Promise.resolve(true);
      },
      teardown: () => {
        cleanoutput(input, format);
        return Promise.resolve();
      },
    });
  }
}