declare var DOM: boolean;

// declare module "cuid" {
//     export function cuid(): string;
// }

declare function cuid();
declare module cuid {}
declare module "cuid" {
  export = cuid;
}

declare interface Document {
    selection: any;
}

declare interface Element {
    offsetTop: any;
}
