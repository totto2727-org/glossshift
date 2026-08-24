{
  description = "A macOS GPUI popup and CLI for streaming translations through Rig";

  inputs.nixpkgs.url = "https://flakehub.com/f/NixOS/nixpkgs/0.1";

  outputs =
    { self, nixpkgs, ... }:
    let
      supportedSystems = [
        "aarch64-darwin"
      ];
      forEachSystem = nixpkgs.lib.genAttrs supportedSystems;
      overlay = final: _previous: {
        glossshift = final.callPackage ./package.nix { };
        gshift = final.callPackage ./package.nix {
          mainProgram = "gshift";
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
          inherit (pkgs) glossshift gshift;
          default = glossshift;
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
