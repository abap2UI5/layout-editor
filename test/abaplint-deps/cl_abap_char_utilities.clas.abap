" The three constants a generated 7.02 class may use for a newline, a
" carriage return or a tab in a text - declared here so the abaplint 7.02
" check (abaplint-702.jsonc) knows them without the whole standard library.
" Not part of the generated class; the runtime check runs on open-abap-core.
CLASS cl_abap_char_utilities DEFINITION PUBLIC FINAL.
  PUBLIC SECTION.
    CONSTANTS newline        TYPE c LENGTH 1 VALUE '_'.
    CONSTANTS cr_lf          TYPE c LENGTH 2 VALUE '__'.
    CONSTANTS horizontal_tab TYPE c LENGTH 1 VALUE '_'.
ENDCLASS.
CLASS cl_abap_char_utilities IMPLEMENTATION.
ENDCLASS.
