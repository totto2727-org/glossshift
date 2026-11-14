{ fetchFromGitHub, applyPatches }:

applyPatches {
  name = "nsh-0.5.0-glossshift-source";
  src = fetchFromGitHub {
    owner = "longbridge";
    repo = "nsh";
    rev = "f4d68f7f9f31eb7b3ecc8a4cbc31096d5c6238a1";
    hash = "sha256-sCZ6ujlxEVRT9BTbdhafLFrgDjs36+M3w72+KmVxeRk=";
  };
  patches = [ ../patches/nsh-macos-lifecycle.patch ];
}
