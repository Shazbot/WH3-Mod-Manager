import type { FlowbiteTheme } from '../components';

const theme: FlowbiteTheme = {
  accordion: {
    base: 'divide-y divide-gray-200 border-gray-200 dark:divide-gray-700 dark:border-gray-700',
    content: {
      base: 'py-5 px-5 last:rounded-b-lg dark:bg-gray-900 first:rounded-t-lg',
    },
    flush: {
      off: 'rounded-lg border',
      on: 'border-b',
    },
    title: {
      arrow: {
        base: 'h-6 w-6 shrink-0',
        open: {
          off: '',
          on: 'rotate-180',
        },
      },
      base: 'flex w-full items-center justify-between first:rounded-t-lg last:rounded-b-lg py-5 px-5 text-left font-medium text-gray-500 dark:text-gray-400',
      flush: {
        off: 'hover:bg-gray-100 focus:ring-4 focus:ring-gray-200 dark:hover:bg-gray-800 dark:focus:ring-gray-800',
        on: '!bg-transparent dark:!bg-transparent',
      },
      heading: '',
      open: {
        off: '',
        on: 'text-gray-900 bg-gray-100 dark:bg-gray-800 dark:text-white',
      },
    },
  },
  alert: {
    base: 'flex flex-col gap-2 p-4 text-sm',
    borderAccent: 'border-t-4',
    closeButton: {
      base: '-mx-1.5 -my-1.5 ml-auto inline-flex h-8 w-8 rounded-lg p-1.5 focus:ring-2',
      color: {
        info: 'bg-blue-100 text-blue-500 hover:bg-blue-200 focus:ring-blue-400 dark:bg-blue-200 dark:text-blue-600 dark:hover:bg-blue-300',
        gray: 'bg-gray-100 text-gray-500 hover:bg-gray-200 focus:ring-gray-400 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white',
        failure:
          'bg-red-100 text-red-500 hover:bg-red-200 focus:ring-red-400 dark:bg-red-200 dark:text-red-600 dark:hover:bg-red-300',
        success:
          'bg-green-100 text-green-500 hover:bg-green-200 focus:ring-green-400 dark:bg-green-200 dark:text-green-600 dark:hover:bg-green-300',
        warning:
          'bg-yellow-100 text-yellow-500 hover:bg-yellow-200 focus:ring-yellow-400 dark:bg-yellow-200 dark:text-yellow-600 dark:hover:bg-yellow-300',
      },
    },
    color: {
      info: 'text-blue-700 bg-blue-100 border-blue-500 dark:bg-blue-200 dark:text-blue-800',
      gray: 'text-gray-700 bg-gray-100 border-gray-500 dark:bg-gray-700 dark:text-gray-300',
      failure: 'text-red-700 bg-red-100 border-red-500 dark:bg-red-200 dark:text-red-800',
      success: 'text-green-700 bg-green-100 border-green-500 dark:bg-green-200 dark:text-green-800',
      warning: 'text-yellow-700 bg-yellow-100 border-yellow-500 dark:bg-yellow-200 dark:text-yellow-800',
    },
    icon: 'mr-3 inline h-5 w-5 flex-shrink-0',
    rounded: 'rounded-lg',
  },
  avatar: {
    base: 'flex items-center space-x-4',
    bordered: 'p-1 ring-2 ring-gray-300 dark:ring-gray-500',
    img: {
      off: 'rounded relative overflow-hidden bg-gray-100 dark:bg-gray-600',
      on: 'rounded',
    },
    rounded: '!rounded-full',
    size: {
      xs: 'w-6 h-6',
      sm: 'w-8 h-8',
      md: 'w-10 h-10',
      lg: 'w-20 h-20',
      xl: 'w-36 h-36',
    },
    stacked: 'ring-2 ring-gray-300 dark:ring-gray-500',
    status: {
      away: 'bg-yellow-400',
      base: 'absolute h-3.5 w-3.5 rounded-full border-2 border-white dark:border-gray-800',
      busy: 'bg-red-400',
      offline: 'bg-gray-400',
      online: 'bg-green-400',
    },
    statusPosition: {
      'bottom-left': '-bottom-1 -left-1',
      'bottom-center': '-botton-1 center',
      'bottom-right': '-bottom-1 -right-1',
      'top-left': '-top-1 -left-1',
      'top-center': '-top-1 center',
      'top-right': '-top-1 -right-1',
      'center-right': 'center -right-1',
      center: 'center center',
      'center-left': 'center -left-1',
    },
  },
  badge: {
    base: 'flex h-fit items-center gap-1 font-semibold',
    color: {
      info: 'bg-blue-100 text-blue-800 dark:bg-blue-200 dark:text-blue-800 group-hover:bg-blue-200 dark:group-hover:bg-blue-300',
      gray: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300 group-hover:bg-gray-200 dark:group-hover:bg-gray-600',
      failure:
        'bg-red-100 text-red-800 dark:bg-red-200 dark:text-red-900 group-hover:bg-red-200 dark:group-hover:bg-red-300',
      success:
        'bg-green-100 text-green-800 dark:bg-green-200 dark:text-green-900 group-hover:bg-green-200 dark:group-hover:bg-green-300',
      warning:
        'bg-yellow-100 text-yellow-800 dark:bg-yellow-200 dark:text-yellow-900 group-hover:bg-yellow-200 dark:group-hover:bg-yellow-300',
      indigo:
        'bg-indigo-100 text-indigo-800 dark:bg-indigo-200 dark:text-indigo-900 group-hover:bg-indigo-200 dark:group-hover:bg-indigo-300',
      purple:
        'bg-purple-100 text-purple-800 dark:bg-purple-200 dark:text-purple-900 group-hover:bg-purple-200 dark:group-hover:bg-purple-300',
      pink: 'bg-pink-100 text-pink-800 dark:bg-pink-200 dark:text-pink-900 group-hover:bg-pink-200 dark:group-hover:bg-pink-300',
    },
    href: 'group',
    icon: {
      off: 'rounded px-2 py-0.5',
      on: 'rounded-full p-1.5',
      size: {
        xs: 'w-3 h-3',
        sm: 'w-3.5 h-3.5',
      },
    },
    size: {
      xs: 'p-1 text-xs',
      sm: 'p-1.5 text-sm',
    },
  },
  breadcrumb: {
    item: {
      base: 'group flex items-center',
      chevron: 'mx-1 h-6 w-6 text-gray-400 group-first:hidden md:mx-2',
      href: {
        off: 'flex items-center text-sm font-medium text-gray-500 dark:text-gray-400',
        on: 'flex items-center text-sm font-medium text-gray-700 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white',
      },
      icon: 'mr-2 h-4 w-4',
    },
    list: 'flex items-center',
  },
  button: {
    base: 'group flex h-min w-fit items-center justify-center p-0.5 text-center font-medium focus:z-10',
    color: {
      dark: 'text-white bg-gray-800 border border-transparent hover:bg-gray-900 focus:ring-4 focus:ring-gray-300 disabled:hover:bg-gray-800 dark:bg-gray-800 dark:hover:bg-gray-700 dark:focus:ring-gray-800 dark:border-gray-700 dark:disabled:hover:bg-gray-800',
      failure:
        'text-white bg-red-700 border border-transparent hover:bg-red-800 focus:ring-4 focus:ring-red-300 disabled:hover:bg-red-800 dark:bg-red-600 dark:hover:bg-red-700 dark:focus:ring-red-900 dark:disabled:hover:bg-red-600',
      gray: 'text-gray-900 bg-white border border-gray-200 hover:bg-gray-100 hover:text-blue-700 disabled:hover:bg-white focus:ring-blue-700 focus:text-blue-700 dark:bg-transparent dark:text-gray-400 dark:border-gray-600 dark:hover:text-white dark:hover:bg-gray-700 focus:ring-2 dark:disabled:hover:bg-gray-800',
      info: 'text-white bg-blue-700 border border-transparent hover:bg-blue-800 focus:ring-4 focus:ring-blue-300 disabled:hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800 dark:disabled:hover:bg-blue-600',
      light:
        'text-gray-900 bg-white border border-gray-300 hover:bg-gray-100 focus:ring-4 focus:ring-blue-300 disabled:hover:bg-white dark:bg-gray-600 dark:text-white dark:border-gray-600 dark:hover:bg-gray-700 dark:hover:border-gray-700 dark:focus:ring-gray-700',
      purple:
        'text-white bg-purple-700 border border-transparent hover:bg-purple-800 focus:ring-4 focus:ring-purple-300 disabled:hover:bg-purple-700 dark:bg-purple-600 dark:hover:bg-purple-700 dark:focus:ring-purple-900 dark:disabled:hover:bg-purple-600',
      success:
        'text-white bg-green-700 border border-transparent hover:bg-green-800 focus:ring-4 focus:ring-green-300 disabled:hover:bg-green-700 dark:bg-green-600 dark:hover:bg-green-700 dark:focus:ring-green-800 dark:disabled:hover:bg-green-600',
      warning:
        'text-white bg-yellow-400 border border-transparent hover:bg-yellow-500 focus:ring-4 focus:ring-yellow-300 disabled:hover:bg-yellow-400 dark:focus:ring-yellow-900 dark:disabled:hover:bg-yellow-400',
    },
    disabled: 'cursor-not-allowed opacity-50',
    gradient: {
      cyan: 'text-white bg-gradient-to-r from-cyan-400 via-cyan-500 to-cyan-600 hover:bg-gradient-to-br focus:ring-4 focus:ring-cyan-300 dark:focus:ring-cyan-800',
      failure:
        'text-white bg-gradient-to-r from-red-400 via-red-500 to-red-600 hover:bg-gradient-to-br focus:ring-4 focus:ring-red-300 dark:focus:ring-red-800',
      info: 'text-white bg-gradient-to-r from-blue-500 via-blue-600 to-blue-700 hover:bg-gradient-to-br focus:ring-4 focus:ring-blue-300 dark:focus:ring-blue-800 ',
      lime: 'text-gray-900 bg-gradient-to-r from-lime-200 via-lime-400 to-lime-500 hover:bg-gradient-to-br focus:ring-4 focus:ring-lime-300 dark:focus:ring-lime-800',

      pink: 'text-white bg-gradient-to-r from-pink-400 via-pink-500 to-pink-600 hover:bg-gradient-to-br focus:ring-4 focus:ring-pink-300 dark:focus:ring-pink-800',
      purple:
        'text-white bg-gradient-to-r from-purple-500 via-purple-600 to-purple-700 hover:bg-gradient-to-br focus:ring-4 focus:ring-purple-300 dark:focus:ring-purple-800',
      success:
        'text-white bg-gradient-to-r from-green-400 via-green-500 to-green-600 hover:bg-gradient-to-br focus:ring-4 focus:ring-green-300 dark:focus:ring-green-800',
      teal: 'text-white bg-gradient-to-r from-teal-400 via-teal-500 to-teal-600 hover:bg-gradient-to-br focus:ring-4 focus:ring-teal-300 dark:focus:ring-teal-800',
    },
    gradientDuoTone: {
      cyanToBlue:
        'text-white bg-gradient-to-r from-cyan-500 to-blue-500 hover:bg-gradient-to-bl focus:ring-4 focus:ring-cyan-300 dark:focus:ring-cyan-800',
      greenToBlue:
        'text-white bg-gradient-to-br from-green-400 to-blue-600 hover:bg-gradient-to-bl focus:ring-4 focus:ring-green-200 dark:focus:ring-green-800',
      pinkToOrange:
        'text-white bg-gradient-to-br from-pink-500 to-orange-400 hover:bg-gradient-to-bl focus:ring-4 focus:ring-pink-200 dark:focus:ring-pink-800',
      purpleToBlue:
        'text-white bg-gradient-to-br from-purple-600 to-blue-500 hover:bg-gradient-to-bl focus:ring-4 focus:ring-blue-300 dark:focus:ring-blue-800',
      purpleToPink:
        'text-white bg-gradient-to-r from-purple-500 to-pink-500 hover:bg-gradient-to-l focus:ring-4 focus:ring-purple-200 dark:focus:ring-purple-800',
      redToYellow:
        'text-gray-900 bg-gradient-to-r from-red-200 via-red-300 to-yellow-200 hover:bg-gradient-to-bl focus:ring-4 focus:ring-red-100 dark:focus:ring-red-400',
      tealToLime:
        'text-gray-900 bg-gradient-to-r from-teal-200 to-lime-200 hover:bg-gradient-to-l hover:from-teal-200 hover:to-lime-200 hover:!text-gray-900 focus:ring-4 focus:ring-lime-200 dark:focus:ring-teal-700',
    },
    inner: {
      base: 'flex items-center',
      position: {
        none: '',
        start: 'rounded-r-none',
        middle: '!rounded-none',
        end: 'rounded-l-none',
      },
    },
    label:
      'ml-2 inline-flex h-4 w-4 items-center justify-center rounded-full bg-blue-200 text-xs font-semibold text-blue-800',
    outline: {
      color: {
        gray: 'border border-gray-900 dark:border-white',
      },
      off: '',
      on: 'bg-white text-gray-900 transition-all duration-75 ease-in group-hover:bg-opacity-0 group-hover:text-inherit dark:bg-gray-900 dark:text-white',
      pill: {
        off: 'rounded-md',
        on: 'rounded-full',
      },
    },
    pill: {
      off: 'rounded-lg',
      on: 'rounded-full',
    },
    size: {
      xs: 'text-xs px-2 py-1',
      sm: 'text-sm px-3 py-1.5',
      md: 'text-sm px-4 py-2',
      lg: 'text-base px-5 py-2.5',
      xl: 'text-base px-6 py-3',
    },
  },
  buttonGroup: {
    base: 'inline-flex',
    position: {
      none: 'focus:!ring-2',
      start: 'rounded-r-none',
      middle: '!rounded-none border-l-0 pl-0',
      end: 'rounded-l-none border-l-0 pl-0',
    },
  },
  card: {
    base: 'flex rounded-lg border border-gray-200 bg-white shadow-md dark:border-gray-700 dark:bg-gray-800',
    children: 'flex h-full flex-col justify-center gap-4 p-6',
    horizontal: {
      off: 'flex-col',
      on: 'flex-col md:max-w-xl md:flex-row',
    },
    href: 'hover:bg-gray-100 dark:hover:bg-gray-700',
    img: {
      base: '',
      horizontal: {
        off: 'rounded-t-lg',
        on: 'h-96 w-full rounded-t-lg object-cover md:h-auto md:w-48 md:rounded-none md:rounded-l-lg',
      },
    },
  },
  carousel: {
    base: 'relative h-full w-full',
    indicators: {
      active: {
        off: 'bg-white/50 hover:bg-white dark:bg-gray-800/50 dark:hover:bg-gray-800',
        on: 'bg-white dark:bg-gray-800',
      },
      base: 'h-3 w-3 rounded-full',
      wrapper: 'absolute bottom-5 left-1/2 flex -translate-x-1/2 space-x-3',
    },
    item: {
      base: 'absolute top-1/2 left-1/2 block w-full -translate-x-1/2 -translate-y-1/2',
      wrapper: 'w-full flex-shrink-0 transform cursor-grab snap-center',
    },
    control: {
      base: 'inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/30 group-hover:bg-white/50 group-focus:outline-none group-focus:ring-4 group-focus:ring-white dark:bg-gray-800/30 dark:group-hover:bg-gray-800/60 dark:group-focus:ring-gray-800/70 sm:h-10 sm:w-10',
      icon: 'h-5 w-5 text-white dark:text-gray-800 sm:h-6 sm:w-6',
    },
    leftControl: 'absolute top-0 left-0 flex h-full items-center justify-center px-4 focus:outline-none',
    rightControl: 'absolute top-0 right-0 flex h-full items-center justify-center px-4 focus:outline-none',
    scrollContainer: {
      base: 'flex h-full snap-mandatory overflow-y-hidden overflow-x-scroll scroll-smooth rounded-lg',
      snap: 'snap-x',
    },
  },
  darkThemeToggle: {
    base: 'rounded-lg p-2.5 text-sm text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-4 focus:ring-gray-200 dark:text-gray-400 dark:hover:bg-gray-700 dark:focus:ring-gray-700',
    icon: 'h-5 w-5',
  },
  dropdown: {
    floating: {
      target: 'w-fit',
      base: 'z-10 w-fit rounded divide-y divide-gray-100 shadow',
      animation: 'transition-opacity',
      hidden: 'invisible opacity-0',
      style: {
        dark: 'bg-gray-900 text-white dark:bg-gray-700',
        light: 'border border-gray-200 bg-white text-gray-900',
        auto: 'border border-gray-200 bg-white text-gray-900 dark:border-none dark:bg-gray-700 dark:text-white',
      },
      header: 'block py-2 px-4 text-sm text-gray-700 dark:text-gray-200',
      content: 'py-1 text-sm text-gray-700 dark:text-gray-200',
      arrow: {
        base: 'absolute z-10 h-2 w-2 rotate-45',
        style: {
          dark: 'bg-gray-900 dark:bg-gray-700',
          light: 'bg-white',
          auto: 'bg-white dark:bg-gray-700',
        },
        placement: '-4px',
      },
      item: {
        base: 'flex items-center justify-start py-2 px-4 text-sm text-gray-700 cursor-pointer hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-600 dark:hover:text-white',
        icon: 'mr-2 h-4 w-4',
      },
      divider: 'my-1 h-px bg-gray-100 dark:bg-gray-600',
    },
    arrowIcon: 'ml-2 h-4 w-4',
    inlineWrapper: 'flex items-center',
    content: 'py-1',
  },
  footer: {
    base: 'w-full rounded-lg bg-white shadow dark:bg-gray-800 md:flex md:items-center md:justify-between',
    container: 'w-full p-6',
    bgDark: 'bg-gray-800',
    groupLink: {
      base: 'flex flex-wrap text-sm text-gray-500 dark:text-white',
      link: {
        base: 'last:mr-0 md:mr-6',
        href: 'hover:underline',
      },
      col: 'flex-col space-y-4',
    },
    icon: {
      base: 'text-gray-500 dark:hover:text-white',
      size: 'h-5 w-5',
    },
    title: {
      base: 'mb-6 text-sm font-semibold uppercase text-gray-500 dark:text-white',
    },
    divider: {
      base: 'w-full my-6 border-gray-200 sm:mx-auto dark:border-gray-700 lg:my-8',
    },
    copyright: {
      base: 'text-sm text-gray-500 dark:text-gray-400 sm:text-center',
      href: 'ml-1 hover:underline',
      span: 'ml-1',
    },
    brand: {
      base: 'mb-4 flex items-center sm:mb-0',
      img: 'mr-3 h-8',
      span: 'self-center whitespace-nowrap text-2xl font-semibold text-gray-800 dark:text-white',
    },
  },
  formControls: {
    helperText: {
      base: 'mt-2 text-sm',
      colors: {
        gray: 'text-gray-500 dark:text-gray-400',
        info: 'text-blue-700 dark:text-blue-800',
        success: 'text-green-600 dark:text-green-500',
        failure: 'text-red-600 dark:text-red-500',
        warning: 'text-yellow-500 dark:text-yellow-600',
      },
    },
    label: {
      base: 'text-sm font-medium',
      colors: {
        default: 'text-gray-900 dark:text-gray-300',
        info: 'text-blue-500 dark:text-blue-600',
        failure: 'text-red-700 dark:text-red-500',
        warning: 'text-yellow-500 dark:text-yellow-600',
        success: 'text-green-700 dark:text-green-500',
      },
      disabled: 'opacity-50',
    },
    radio: {
      base: 'h-4 w-4 border border-gray-300 focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:focus:bg-blue-600 dark:focus:ring-blue-600',
    },
    checkbox: {
      base: 'h-4 w-4 rounded border border-gray-300 bg-gray-100 focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:ring-offset-gray-800 dark:focus:ring-blue-600',
    },
    textInput: {
      base: 'flex',
      addon:
        'inline-flex items-center rounded-l-md border border-r-0 border-gray-300 bg-gray-200 px-3 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-600 dark:text-gray-400',
      field: {
        base: 'relative w-full',
        icon: {
          base: 'pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3',
          svg: 'h-5 w-5 text-gray-500 dark:text-gray-400',
        },
        input: {
          base: 'block w-full border disabled:cursor-not-allowed disabled:opacity-50',
          sizes: {
            sm: 'p-2 sm:text-xs',
            md: 'p-2.5 text-sm',
            lg: 'sm:text-md p-4',
          },
          colors: {
            gray: 'bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 dark:focus:border-blue-500 dark:focus:ring-blue-500',
            info: 'border-blue-500 bg-blue-50 text-blue-900 placeholder-blue-700 focus:border-blue-500 focus:ring-blue-500 dark:border-blue-400 dark:bg-blue-100 dark:focus:border-blue-500 dark:focus:ring-blue-500',
            failure:
              'border-red-500 bg-red-50 text-red-900 placeholder-red-700 focus:border-red-500 focus:ring-red-500 dark:border-red-400 dark:bg-red-100 dark:focus:border-red-500 dark:focus:ring-red-500',
            warning:
              'border-yellow-500 bg-yellow-50 text-yellow-900 placeholder-yellow-700 focus:border-yellow-500 focus:ring-yellow-500 dark:border-yellow-400 dark:bg-yellow-100 dark:focus:border-yellow-500 dark:focus:ring-yellow-500',
            success:
              'border-green-500 bg-green-50 text-green-900 placeholder-green-700 focus:border-green-500 focus:ring-green-500 dark:border-green-400 dark:bg-green-100 dark:focus:border-green-500 dark:focus:ring-green-500',
          },
          withIcon: {
            on: 'pl-10',
            off: '',
          },
          withAddon: {
            on: 'rounded-r-lg',
            off: 'rounded-lg',
          },
          withShadow: {
            on: 'shadow-sm dark:shadow-sm-light',
            off: '',
          },
        },
      },
    },
    fileInput: {
      base: 'flex',
      field: {
        base: 'relative w-full',
        input: {
          base: 'rounded-lg block w-full border disabled:cursor-not-allowed disabled:opacity-50',
          sizes: {
            sm: 'sm:text-xs',
            md: 'text-sm',
            lg: 'sm:text-md',
          },
          colors: {
            gray: 'bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 dark:focus:border-blue-500 dark:focus:ring-blue-500',
            info: 'border-blue-500 bg-blue-50 text-blue-900 placeholder-blue-700 focus:border-blue-500 focus:ring-blue-500 dark:border-blue-400 dark:bg-blue-100 dark:focus:border-blue-500 dark:focus:ring-blue-500',
            failure:
              'border-red-500 bg-red-50 text-red-900 placeholder-red-700 focus:border-red-500 focus:ring-red-500 dark:border-red-400 dark:bg-red-100 dark:focus:border-red-500 dark:focus:ring-red-500',
            warning:
              'border-yellow-500 bg-yellow-50 text-yellow-900 placeholder-yellow-700 focus:border-yellow-500 focus:ring-yellow-500 dark:border-yellow-400 dark:bg-yellow-100 dark:focus:border-yellow-500 dark:focus:ring-yellow-500',
            success:
              'border-green-500 bg-green-50 text-green-900 placeholder-green-700 focus:border-green-500 focus:ring-green-500 dark:border-green-400 dark:bg-green-100 dark:focus:border-green-500 dark:focus:ring-green-500',
          },
        },
      },
    },
    toggleSwitch: {
      base: 'group relative flex items-center rounded-lg focus:outline-none',
      active: {
        on: 'cursor-pointer',
        off: 'cursor-not-allowed opacity-50',
      },
      toggle: {
        base: 'toggle-bg h-6 w-11 rounded-full border group-focus:ring-4 group-focus:ring-blue-500/25',
        checked: {
          on: 'border-blue-700 bg-blue-700 after:translate-x-full after:border-white',
          off: 'border-gray-200 bg-gray-200 dark:border-gray-600 dark:bg-gray-700',
        },
      },
      label: 'ml-3 text-sm font-medium text-gray-900 dark:text-gray-300',
    },
    textarea: {
      base: 'block w-full rounded-lg border disabled:cursor-not-allowed disabled:opacity-50',
      colors: {
        gray: 'bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 dark:focus:border-blue-500 dark:focus:ring-blue-500',
        info: 'border-blue-500 bg-blue-50 text-blue-900 placeholder-blue-700 focus:border-blue-500 focus:ring-blue-500 dark:border-blue-400 dark:bg-blue-100 dark:focus:border-blue-500 dark:focus:ring-blue-500',
        failure:
          'border-red-500 bg-red-50 text-red-900 placeholder-red-700 focus:border-red-500 focus:ring-red-500 dark:border-red-400 dark:bg-red-100 dark:focus:border-red-500 dark:focus:ring-red-500',
        warning:
          'border-yellow-500 bg-yellow-50 text-yellow-900 placeholder-yellow-700 focus:border-yellow-500 focus:ring-yellow-500 dark:border-yellow-400 dark:bg-yellow-100 dark:focus:border-yellow-500 dark:focus:ring-yellow-500',
        success:
          'border-green-500 bg-green-50 text-green-900 placeholder-green-700 focus:border-green-500 focus:ring-green-500 dark:border-green-400 dark:bg-green-100 dark:focus:border-green-500 dark:focus:ring-green-500',
      },
      withShadow: {
        on: 'shadow-sm dark:shadow-sm-light',
        off: '',
      },
    },
    select: {
      base: 'flex',
      addon:
        'inline-flex items-center rounded-l-md border border-r-0 border-gray-300 bg-gray-200 px-3 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-600 dark:text-gray-400',
      field: {
        base: 'relative w-full',
        icon: {
          base: 'pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3',
          svg: 'h-5 w-5 text-gray-500 dark:text-gray-400',
        },
        select: {
          base: 'block w-full border disabled:cursor-not-allowed disabled:opacity-50',
          withIcon: {
            on: 'pl-10',
            off: '',
          },
          withAddon: {
            on: 'rounded-r-lg',
            off: 'rounded-lg',
          },
          withShadow: {
            on: 'shadow-sm dark:shadow-sm-light',
            off: '',
          },
          sizes: {
            sm: 'p-2 sm:text-xs',
            md: 'p-2.5 text-sm',
            lg: 'sm:text-md p-4',
          },
          colors: {
            gray: 'bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 dark:focus:border-blue-500 dark:focus:ring-blue-500',
            info: 'border-blue-500 bg-blue-50 text-blue-900 placeholder-blue-700 focus:border-blue-500 focus:ring-blue-500 dark:border-blue-400 dark:bg-blue-100 dark:focus:border-blue-500 dark:focus:ring-blue-500',
            failure:
              'border-red-500 bg-red-50 text-red-900 placeholder-red-700 focus:border-red-500 focus:ring-red-500 dark:border-red-400 dark:bg-red-100 dark:focus:border-red-500 dark:focus:ring-red-500',
            warning:
              'border-yellow-500 bg-yellow-50 text-yellow-900 placeholder-yellow-700 focus:border-yellow-500 focus:ring-yellow-500 dark:border-yellow-400 dark:bg-yellow-100 dark:focus:border-yellow-500 dark:focus:ring-yellow-500',
            success:
              'border-green-500 bg-green-50 text-green-900 placeholder-green-700 focus:border-green-500 focus:ring-green-500 dark:border-green-400 dark:bg-green-100 dark:focus:border-green-500 dark:focus:ring-green-500',
          },
        },
      },
    },
  },
  listGroup: {
    base: 'list-none rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white',
    item: {
      active: {
        off: 'hover:bg-gray-100 hover:text-blue-700 focus:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700 dark:border-gray-600 dark:hover:bg-gray-600 dark:hover:text-white dark:focus:text-white dark:focus:ring-gray-500',
        on: 'bg-blue-700 text-white dark:bg-gray-800',
      },
      base: 'flex w-full cursor-pointer border-b border-gray-200 py-2 px-4 first:rounded-t-lg last:rounded-b-lg last:border-b-0 dark:border-gray-600',
      href: {
        off: '',
        on: '',
      },
      icon: 'mr-2 h-4 w-4 fill-current',
    },
  },
  modal: {
    base: 'fixed top-0 right-0 left-0 z-50 h-modal overflow-y-auto overflow-x-hidden md:inset-0 md:h-full',
    show: {
      on: 'flex bg-gray-900 bg-opacity-50 dark:bg-opacity-80',
      off: 'hidden',
    },
    content: {
      base: 'relative h-full w-full p-4 md:h-auto',
      inner: 'relative rounded-lg bg-white shadow dark:bg-gray-700',
    },
    body: {
      base: 'p-6',
      popup: 'pt-0',
    },
    header: {
      base: 'flex items-start justify-between rounded-t dark:border-gray-600 border-b p-5',
      popup: '!p-2 !border-b-0',
      title: 'text-xl font-medium text-gray-900 dark:text-white',
      close: {
        base: 'ml-auto inline-flex items-center rounded-lg bg-transparent p-1.5 text-sm text-gray-400 hover:bg-gray-200 hover:text-gray-900 dark:hover:bg-gray-600 dark:hover:text-white',
        icon: 'h-5 w-5',
      },
    },
    footer: {
      base: 'flex items-center space-x-2 rounded-b border-gray-200 p-6 dark:border-gray-600',
      popup: 'border-t',
    },
    sizes: {
      sm: 'max-w-sm',
      md: 'max-w-md',
      lg: 'max-w-lg',
      xl: 'max-w-xl',
      '2xl': 'max-w-2xl',
      '3xl': 'max-w-3xl',
      '4xl': 'max-w-4xl',
      '5xl': 'max-w-5xl',
      '6xl': 'max-w-6xl',
      '7xl': 'max-w-7xl',
    },
    positions: {
      'top-left': 'items-start justify-start',
      'top-center': 'items-start justify-center',
      'top-right': 'items-start justify-end',
      'center-left': 'items-center justify-start',
      center: 'items-center justify-center',
      'center-right': 'items-center justify-end',
      'bottom-right': 'items-end justify-end',
      'bottom-center': 'items-end justify-center',
      'bottom-left': 'items-end justify-start',
    },
  },
  navbar: {
    base: 'border-gray-200 bg-white px-2 py-2.5 dark:border-gray-700 dark:bg-gray-800 sm:px-4',
    rounded: {
      on: 'rounded',
      off: '',
    },
    bordered: {
      on: 'border',
      off: '',
    },
    inner: {
      base: 'mx-auto flex flex-wrap items-center justify-between',
      fluid: {
        on: '',
        off: 'container',
      },
    },
    brand: 'flex items-center',
    collapse: {
      base: 'w-full md:block md:w-auto',
      list: 'mt-4 flex flex-col md:mt-0 md:flex-row md:space-x-8 md:text-sm md:font-medium',
      hidden: {
        on: 'hidden',
        off: '',
      },
    },
    link: {
      base: 'block py-2 pr-4 pl-3 md:p-0',
      active: {
        on: 'bg-blue-700 text-white dark:text-white md:bg-transparent md:text-blue-700',
        off: 'border-b border-gray-100  text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-white md:border-0 md:hover:bg-transparent md:hover:text-blue-700 md:dark:hover:bg-transparent md:dark:hover:text-white',
      },
      disabled: {
        on: 'text-gray-400 hover:cursor-not-allowed dark:text-gray-600',
        off: '',
      },
    },
    toggle: {
      base: 'inline-flex items-center rounded-lg p-2 text-sm text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-200 dark:text-gray-400 dark:hover:bg-gray-700 dark:focus:ring-gray-600 md:hidden',
      icon: 'h-6 w-6 shrink-0',
    },
  },
  rating: {
    base: 'flex items-center',
    star: {
      sizes: {
        sm: 'w-5 h-5',
        md: 'w-7 h-7',
        lg: 'w-10 h-10',
      },
      filled: 'text-yellow-400',
      empty: 'text-gray-300 dark:text-gray-500',
    },
    advanced: {
      base: 'flex items-center',
      label: 'text-sm font-medium text-blue-600 dark:text-blue-500',
      progress: {
        base: 'mx-4 h-5 w-2/4 rounded bg-gray-200 dark:bg-gray-700',
        fill: 'h-5 rounded bg-yellow-400',
        label: 'text-sm font-medium text-blue-600 dark:text-blue-500',
      },
    },
  },
  pagination: {
    base: '',
    layout: {
      table: {
        base: 'text-sm text-gray-700 dark:text-gray-400',
        span: 'font-semibold text-gray-900 dark:text-white',
      },
    },
    pages: {
      base: 'xs:mt-0 mt-2 inline-flex items-center -space-x-px',
      showIcon: 'inline-flex',
      previous: {
        base: 'ml-0 rounded-l-lg border border-gray-300 bg-white py-2 px-3 leading-tight text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-white',
        icon: 'h-5 w-5',
      },
      next: {
        base: 'rounded-r-lg border border-gray-300 bg-white py-2 px-3 leading-tight text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-white',
        icon: 'h-5 w-5',
      },
      selector: {
        base: 'w-12 border border-gray-300 bg-white py-2 leading-tight text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-white',
        active:
          'bg-blue-50 text-blue-600 hover:bg-blue-100 hover:text-blue-700 dark:border-gray-700 dark:bg-gray-700 dark:text-white',
      },
    },
  },
  sidebar: {
    base: 'h-full',
    inner: 'h-full overflow-y-auto overflow-x-hidden rounded bg-white py-4 px-3 dark:bg-gray-800',
    collapsed: {
      on: 'w-16',
      off: 'w-64',
    },
    collapse: {
      button:
        'group flex w-full items-center rounded-lg p-2 text-base font-normal text-gray-900 transition duration-75 hover:bg-gray-100 dark:text-white dark:hover:bg-gray-700',
      icon: {
        base: 'h-6 w-6 text-gray-500 transition duration-75 group-hover:text-gray-900 dark:text-gray-400 dark:group-hover:text-white',
        open: {
          off: '',
          on: 'text-gray-900',
        },
      },
      label: {
        base: 'ml-3 flex-1 whitespace-nowrap text-left',
        icon: 'h-6 w-6',
      },
      list: 'space-y-2 py-2',
    },
    cta: {
      base: 'mt-6 rounded-lg p-4',
      color: {
        blue: 'bg-blue-50 dark:bg-blue-900',
        dark: 'bg-dark-50 dark:bg-dark-900',
        failure: 'bg-red-50 dark:bg-red-900',
        gray: 'bg-alternative-50 dark:bg-alternative-900',
        green: 'bg-green-50 dark:bg-green-900',
        light: 'bg-light-50 dark:bg-light-900',
        red: 'bg-red-50 dark:bg-red-900',
        purple: 'bg-purple-50 dark:bg-purple-900',
        success: 'bg-green-50 dark:bg-green-900',
        yellow: 'bg-yellow-50 dark:bg-yellow-900',
        warning: 'bg-yellow-50 dark:bg-yellow-900',
      },
    },
    item: {
      base: 'flex items-center justify-center rounded-lg p-2 text-base font-normal text-gray-900 hover:bg-gray-100 dark:text-white dark:hover:bg-gray-700',
      active: 'bg-gray-100 dark:bg-gray-700',
      collapsed: {
        insideCollapse: 'group w-full pl-8 transition duration-75',
        noIcon: 'font-bold',
      },
      content: {
        base: 'px-3 flex-1 whitespace-nowrap',
      },
      icon: {
        base: 'h-6 w-6 flex-shrink-0 text-gray-500 transition duration-75 group-hover:text-gray-900 dark:text-gray-400 dark:group-hover:text-white',
        active: 'text-gray-700 dark:text-gray-100',
      },
    },
    items: '',
    itemGroup:
      'mt-4 space-y-2 border-t border-gray-200 pt-4 first:mt-0 first:border-t-0 first:pt-0 dark:border-gray-700',
    logo: {
      base: 'mb-5 flex items-center pl-2.5',
      collapsed: {
        on: 'hidden',
        off: 'self-center whitespace-nowrap text-xl font-semibold dark:text-white',
      },
      img: 'mr-3 h-6 sm:h-7',
    },
  },
  progress: {
    base: 'w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700',
    label: 'mb-1 flex justify-between font-medium dark:text-white',
    bar: 'flex items-center justify-center rounded-full text-center font-medium leading-none text-blue-100',
    color: {
      dark: 'bg-gray-600 dark:bg-gray-300',
      blue: 'bg-blue-600',
      red: 'bg-red-600 dark:bg-red-500',
      green: 'bg-green-600 dark:bg-green-500',
      yellow: 'bg-yellow-400',
      indigo: 'bg-indigo-600 dark:bg-indigo-500',
      purple: 'bg-purple-600 dark:bg-purple-500',
    },
    size: {
      sm: 'h-1.5',
      md: 'h-2.5',
      lg: 'h-4',
      xl: 'h-6',
    },
  },
  spinner: {
    base: 'inline animate-spin text-gray-200',
    color: {
      failure: 'fill-red-600',
      gray: 'fill-gray-600',
      info: 'fill-blue-600',
      pink: 'fill-pink-600',
      purple: 'fill-purple-600',
      success: 'fill-green-500',
      warning: 'fill-yellow-400',
    },
    light: {
      off: {
        base: 'dark:text-gray-600',
        color: {
          failure: '',
          gray: 'dark:fill-gray-300',
          info: '',
          pink: '',
          purple: '',
          success: '',
          warning: '',
        },
      },
      on: {
        base: '',
        color: {
          failure: '',
          gray: '',
          info: '',
          pink: '',
          purple: '',
          success: '',
          warning: '',
        },
      },
    },
    size: {
      xs: 'w-3 h-3',
      sm: 'w-4 h-4',
      md: 'w-6 h-6',
      lg: 'w-8 h-8',
      xl: 'w-10 h-10',
    },
  },
  tab: {
    base: 'flex flex-col gap-2',
    tablist: {
      base: 'flex text-center',
      styles: {
        default: 'flex-wrap border-b border-gray-200 dark:border-gray-700',
        underline: 'flex-wrap -mb-px border-b border-gray-200 dark:border-gray-700',
        pills: 'flex-wrap font-medium text-sm text-gray-500 dark:text-gray-400',
        fullWidth:
          'hidden text-sm font-medium rounded-lg divide-x divide-gray-200 shadow sm:flex dark:divide-gray-700 dark:text-gray-400',
      },
      tabitem: {
        base: 'flex items-center justify-center p-4 text-sm font-medium first:ml-0 disabled:cursor-not-allowed disabled:text-gray-400 disabled:dark:text-gray-500',
        styles: {
          default: {
            base: 'rounded-t-lg',
            active: {
              on: 'bg-gray-100 text-blue-600 dark:bg-gray-800 dark:text-blue-500',
              off: 'text-gray-500 hover:bg-gray-50 hover:text-gray-600 dark:text-gray-400 dark:hover:bg-gray-800  dark:hover:text-gray-300',
            },
          },
          underline: {
            base: 'rounded-t-lg',
            active: {
              on: 'text-blue-600 rounded-t-lg border-b-2 border-blue-600 active dark:text-blue-500 dark:border-blue-500',
              off: 'border-b-2 border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-600 dark:text-gray-400 dark:hover:text-gray-300',
            },
          },
          pills: {
            base: '',
            active: {
              on: 'rounded-lg bg-blue-600 text-white',
              off: 'rounded-lg hover:text-gray-900 hover:bg-gray-100 dark:hover:bg-gray-800 dark:hover:text-white',
            },
          },
          fullWidth: {
            base: 'ml-2 first:ml-0 w-full first:rounded-l-lg last:rounded-r-lg',
            active: {
              on: 'inline-block p-4 w-full text-gray-900 bg-gray-100 focus:ring-4 focus:ring-blue-300 active focus:outline-none dark:bg-gray-700 dark:text-white',
              off: 'bg-white hover:text-gray-700 hover:bg-gray-50 focus:ring-4 focus:ring-blue-300 focus:outline-none dark:hover:text-white dark:bg-gray-800 dark:hover:bg-gray-700',
            },
          },
        },
        icon: 'mr-2 h-5 w-5',
      },
    },
    tabpanel: 'p-4',
  },
  toast: {
    base: 'flex w-full max-w-xs items-center rounded-lg bg-white p-4 text-gray-500 shadow dark:bg-gray-800 dark:text-gray-400',
    closed: 'opacity-0 ease-out',
    removed: 'hidden',
    toggle: {
      base: '-mx-1.5 -my-1.5 ml-auto inline-flex h-8 w-8 rounded-lg bg-white p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-900 focus:ring-2 focus:ring-gray-300 dark:bg-gray-800 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-white',
      icon: 'h-5 w-5 shrink-0',
    },
  },
  tooltip: {
    target: 'w-fit',
    base: 'absolute inline-block rounded-lg py-2 px-3 text-sm font-medium shadow-sm',
    animation: 'transition-opacity',
    hidden: 'invisible opacity-0',
    style: {
      dark: 'bg-gray-900 text-white dark:bg-gray-700',
      light: 'border border-gray-200 bg-white text-gray-900',
      auto: 'border border-gray-200 bg-white text-gray-900 dark:border-none dark:bg-gray-700 dark:text-white',
    },
    content: 'relative z-20',
    arrow: {
      base: 'absolute z-10 h-2 w-2 rotate-45',
      style: {
        dark: 'bg-gray-900 dark:bg-gray-700',
        light: 'bg-white',
        auto: 'bg-white dark:bg-gray-700',
      },
      placement: '-4px',
    },
  },
};

export default theme;
