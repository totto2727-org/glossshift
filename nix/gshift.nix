{ lib, runCommand, glossshift }:

runCommand "gshift-0.2.0" {
  meta = {
    description = "GlossShift terminal UI and Markdown batch translator";
    license = lib.licenses.mit;
    mainProgram = "gshift";
    platforms = [ "aarch64-darwin" ];
  };
} ''
  mkdir -p "$out/bin"
  ln -s "${glossshift}/bin/gshift" "$out/bin/gshift"
''
