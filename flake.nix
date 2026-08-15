{
  description = "A macOS GPUI popup and CLI for streaming translations through Rig";

  inputs.nixpkgs.url = "https://flakehub.com/f/NixOS/nixpkgs/0.1";

  outputs =
    { self, nixpkgs, ... }:
    let
      supportedSystems = [
        "aarch64-darwin"
        "x86_64-darwin"
      ];
      forEachSystem = nixpkgs.lib.genAttrs supportedSystems;
      overlay = final: _previous: {
        translate-popup = final.callPackage ./package.nix { };
        translate-popup-cli = final.callPackage ./package.nix {
          mainProgram = "translate-popup-cli";
        };
      };
      mkPkgs = system: import nixpkgs {
        inherit system;
        overlays = [ overlay ];
      };
    in
    {
      overlays.default = overlay;

      packages = forEachSystem (
        system:
        let
          pkgs = mkPkgs system;
        in
        rec {
          inherit (pkgs) translate-popup translate-popup-cli;
          default = translate-popup;
        }
      );

      devShells = forEachSystem (
        system:
        let
          pkgs = mkPkgs system;
        in
        {
          default = pkgs.mkShell {
            inputsFrom = [ self.packages.${system}.default ];
            packages = [
              pkgs.cargo
              pkgs.clippy
              pkgs.just
              pkgs.rustc
              pkgs.rustfmt
            ];
          };
        }
      );
    };
}
