
from __future__ import annotations

import base64
import io
import zipfile

from harness import Drive
from playwright.sync_api import Browser, Page

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

PLAIN = (
    "JVBERi0xLjcKJcfsj6IKJSVJbnZvY2F0aW9uOiBncyAtcSAtZE5PUEFVU0UgLWRCQVRDSCAtc0RFVklDRT1wZGZ3"
    "cml0ZSAtc091dHB1dEZpbGU9PyA/CjUgMCBvYmoKPDwvTGVuZ3RoIDYgMCBSL0ZpbHRlciAvRmxhdGVEZWNvZGU+"
    "PgpzdHJlYW0KeJwrVDDQM1QwAEEonZzLZaCQzlXIZQgWVYBSybkKTiFc+kHmCiYWCiFpXBDFhgrmRgpmFgYKIblc"
    "GgGOAa5BCv5+rpohWVyuIVyBQAgAk0YTgGVuZHN0cmVhbQplbmRvYmoKMTEgMCBvYmoKPDwvTGVuZ3RoIDEyIDAg"
    "Ui9GaWx0ZXIgL0ZsYXRlRGVjb2RlPj4Kc3RyZWFtCnicK1Qw0DNUMABBKJ2cywXmKhSlgxnmRhBclKqQxlXIZQiR"
    "hFLJuQpOIVz6QeYKJhYKIWlcECMMgRoUzCwMFEJyuTQCHANcgxRCwv01Q7K4XEO4AoEQAHIvGCNlbmRzdHJlYW0K"
    "ZW5kb2JqCjQgMCBvYmoKPDwvVHlwZS9QYWdlL01lZGlhQm94IFswIDAgNjEyIDc5Ml0KL1JvdGF0ZSAwL1BhcmVu"
    "dCAzIDAgUgovUmVzb3VyY2VzPDwvUHJvY1NldFsvUERGIC9UZXh0XQovRm9udCA5IDAgUgo+PgovQ29udGVudHMg"
    "NSAwIFIKPj4KZW5kb2JqCjEwIDAgb2JqCjw8L1R5cGUvUGFnZS9NZWRpYUJveCBbMCAwIDYxMiA3OTJdCi9Sb3Rh"
    "dGUgMC9QYXJlbnQgMyAwIFIKL1Jlc291cmNlczw8L1Byb2NTZXRbL1BERiAvVGV4dF0KL0ZvbnQgMTMgMCBSCj4+"
    "Ci9Db250ZW50cyAxMSAwIFIKPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFsKNCAwIFIK"
    "MTAgMCBSCl0gL0NvdW50IDIKPj4KZW5kb2JqCjEgMCBvYmoKPDwvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMyAwIFIK"
    "L01ldGFkYXRhIDE1IDAgUgo+PgplbmRvYmoKMTQgMCBvYmoKPDwvRmlsdGVyL0ZsYXRlRGVjb2RlL0xlbmd0aCAy"
    "MTE+PnN0cmVhbQp4nF2QwQ6CMAxA7/uK/QGDsBgT0gteOGiM+gNzdGQHxjLx4N/bFvXg4TV50HZtq344DCmuujqX"
    "xV9x1SGmseBjeRaP+o5TTKpu9Bj9+jGJfnZZVf3R5dsro6YEDJuf3IzVpW7lS73V+GXER3Yei0sTqs4Y6EIAhWn8"
    "+7XfCu7hk9lQJmMMRdW1NQjGUCS1IJBaVgSBFFkDCKT0VmepjZVWllvZBgTShrUFgbRl3YFAupM5vxPxyLz7d1Xt"
    "n6VgWuVAcgBePCb83TAvmas0od7yg2yXCmVuZHN0cmVhbQplbmRvYmoKMTUgMCBvYmoKPDwvVHlwZS9NZXRhZGF0"
    "YQovU3VidHlwZS9YTUwvTGVuZ3RoIDE0NTM+PnN0cmVhbQo8P3hwYWNrZXQgYmVnaW49J++7vycgaWQ9J1c1TTBN"
    "cENlaGlIenJlU3pOVGN6a2M5ZCc/Pgo8P2Fkb2JlLXhhcC1maWx0ZXJzIGVzYz0iQ1JMRiI/Pgo8eDp4bXBtZXRh"
    "IHhtbG5zOng9J2Fkb2JlOm5zOm1ldGEvJyB4OnhtcHRrPSdYTVAgdG9vbGtpdCAyLjkuMS0xMywgZnJhbWV3b3Jr"
    "IDEuNic+CjxyZGY6UkRGIHhtbG5zOnJkZj0naHR0cDovL3d3dy53My5vcmcvMTk5OS8wMi8yMi1yZGYtc3ludGF4"
    "LW5zIycgeG1sbnM6aVg9J2h0dHA6Ly9ucy5hZG9iZS5jb20vaVgvMS4wLyc+CjxyZGY6RGVzY3JpcHRpb24gcmRm"
    "OmFib3V0PSIiIHhtbG5zOnBkZj0naHR0cDovL25zLmFkb2JlLmNvbS9wZGYvMS4zLycgcGRmOlByb2R1Y2VyPSdH"
    "UEwgR2hvc3RzY3JpcHQgMTAuMDYuMCcvPgo8cmRmOkRlc2NyaXB0aW9uIHJkZjphYm91dD0iIiB4bWxuczp4bXA9"
    "J2h0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC8nPjx4bXA6TW9kaWZ5RGF0ZT4yMDI2LTExLTAzVDIwOjM4OjIx"
    "KzAxOjAwPC94bXA6TW9kaWZ5RGF0ZT4KPHhtcDpDcmVhdGVEYXRlPjIwMjYtMTEtMDNUMjA6Mzg6MjErMDE6MDA8"
    "L3htcDpDcmVhdGVEYXRlPgo8eG1wOk1ldGFkYXRhRGF0ZT4yMDI2LTExLTAzVDIwOjM4OjIxKzAxOjAwPC94bXA6"
    "TWV0YWRhdGFEYXRlPgo8eG1wOkNyZWF0b3JUb29sPlVua25vd25BcHBsaWNhdGlvbjwveG1wOkNyZWF0b3JUb29s"
    "PjwvcmRmOkRlc2NyaXB0aW9uPgo8cmRmOkRlc2NyaXB0aW9uIHJkZjphYm91dD0iIiB4bWxuczp4bXBNTT0naHR0"
    "cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL21tLycgeG1wTU06RG9jdW1lbnRJRD0ndXVpZDphZDI1YTg0My0wZmRh"
    "LTExZmQtMDAwMC1kODQ5YTBiZTk4ODYnLz4KPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIgeG1sbnM6eG1w"
    "TU09J2h0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9tbS8nIHhtcE1NOlJlbmRpdGlvbkNsYXNzPSdkZWZhdWx0"
    "Jy8+CjxyZGY6RGVzY3JpcHRpb24gcmRmOmFib3V0PSIiIHhtbG5zOnhtcE1NPSdodHRwOi8vbnMuYWRvYmUuY29t"
    "L3hhcC8xLjAvbW0vJyB4bXBNTTpWZXJzaW9uSUQ9JzEnLz4KPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIg"
    "eG1sbnM6ZGM9J2h0dHA6Ly9wdXJsLm9yZy9kYy9lbGVtZW50cy8xLjEvJyBkYzpmb3JtYXQ9J2FwcGxpY2F0aW9u"
    "L3BkZic+PGRjOnRpdGxlPjxyZGY6QWx0PjxyZGY6bGkgeG1sOmxhbmc9J3gtZGVmYXVsdCc+VW50aXRsZWQ8L3Jk"
    "ZjpsaT48L3JkZjpBbHQ+PC9kYzp0aXRsZT48L3JkZjpEZXNjcmlwdGlvbj4KPC9yZGY6UkRGPgo8L3g6eG1wbWV0"
    "YT4KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg"
    "ICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg"
    "ICAgICAgICAgICAgICAgIAo8P3hwYWNrZXQgZW5kPSd3Jz8+CmVuZHN0cmVhbQplbmRvYmoKOCAwIG9iago8PC9G"
    "aWx0ZXIvRmxhdGVEZWNvZGUKL1R5cGUvT2JqU3RtCi9OIDYKL0ZpcnN0IDMxL0xlbmd0aCAxNzk+PnN0cmVhbQp4"
    "nH3OzwqCQBDH8fs+xdw0AndmV/wT4qEkOxSI2QNsupAQruga9PatdOvQ8fvjwzARIKQggQRQDCRBIMQgQ3CNCIlg"
    "WcbrmMXO1XnOUvoZXO3VrI9msPykny9t+1bxxtyGvjWdBgpXyJv3qPmKGL8ud7vWOtH3QjWZbmn15JfVGcqHme3c"
    "Tv1o3Q8BRgFuGD9MWtneDIWy2i92AkVEhFKgTARtkTxEz7GL6f6KPP8A4R8+ewplbmRzdHJlYW0KZW5kb2JqCjE2"
    "IDAgb2JqCjw8Ci9UeXBlIC9YUmVmCi9TaXplIDE3Ci9Sb290IDEgMCBSIC9JbmZvIDIgMCBSCi9JRCBbPDE0QjBB"
    "NDMwNzhCOEM1QTU5RjdBRkZDQTE5RTE5MDU1PjwxNEIwQTQzMDc4QjhDNUE1OUY3QUZGQ0ExOUUxOTA1NT5dCi9J"
    "bmRleCBbMCAxNyBdCi9XIFsxIDIgMl0KL0ZpbHRlciAvRmxhdGVEZWNvZGUvTGVuZ3RoIDY5Cj4+CnN0cmVhbQp4"
    "nGNgYPj/n5HpEwMDEwMHAysj0wYGBkbGyUCCIQIiBiZYGLlcICxGRiYFkOwHCJcJRDAzMhsDxVi8gAR3GAMDAJUf"
    "BysKZW5kc3RyZWFtCmVuZG9iagpzdGFydHhyZWYKMjkwMgolJUVPRgo="
)
LOCKED = (
    "JVBERi0xLjcKJcfsj6IKJSVJbnZvY2F0aW9uOiBncyAtcSAtZE5PUEFVU0UgLWRCQVRDSCAtc0RFVklDRT1wZGZ3"
    "cml0ZSAtc093bmVyUGFzc3dvcmQ9PyAtc091dHB1dEZpbGU9PyA/CjUgMCBvYmoKPDwvTGVuZ3RoIDYgMCBSL0Zp"
    "bHRlciAvRmxhdGVEZWNvZGU+PgpzdHJlYW0KAt8Wb5act9L8RE0+Cey1AMiPb/Kw+oAkt7RgfCkyhteKsA0vL7VP"
    "q3tbGx/7PJgBCmiDCOxYpLhnDC7Uma6SkzmptDCawQZhiOhFYh2dm9uzGmVuZHN0cmVhbQplbmRvYmoKMTEgMCBv"
    "YmoKPDwvTGVuZ3RoIDEyIDAgUi9GaWx0ZXIgL0ZsYXRlRGVjb2RlPj4Kc3RyZWFtCr/Y9qAjyL8x0bwp+7rNkhji"
    "qBOAgZdz0M4OPnC9+1hl34JJOVetaEfBEgWNLxVWOqLtW+cDHAhxKPjSKMS+yP8Ki6EpRvzIfPII9TfxFHDSxQxh"
    "amTjNIMX8BhlbmRzdHJlYW0KZW5kb2JqCjQgMCBvYmoKPDwvVHlwZS9QYWdlL01lZGlhQm94IFswIDAgNjEyIDc5"
    "Ml0KL1JvdGF0ZSAwL1BhcmVudCAzIDAgUgovUmVzb3VyY2VzPDwvUHJvY1NldFsvUERGIC9UZXh0XQovRm9udCA5"
    "IDAgUgo+PgovQ29udGVudHMgNSAwIFIKPj4KZW5kb2JqCjEwIDAgb2JqCjw8L1R5cGUvUGFnZS9NZWRpYUJveCBb"
    "MCAwIDYxMiA3OTJdCi9Sb3RhdGUgMC9QYXJlbnQgMyAwIFIKL1Jlc291cmNlczw8L1Byb2NTZXRbL1BERiAvVGV4"
    "dF0KL0ZvbnQgMTMgMCBSCj4+Ci9Db250ZW50cyAxMSAwIFIKPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1Bh"
    "Z2VzIC9LaWRzIFsKNCAwIFIKMTAgMCBSCl0gL0NvdW50IDIKPj4KZW5kb2JqCjEgMCBvYmoKPDwvVHlwZSAvQ2F0"
    "YWxvZyAvUGFnZXMgMyAwIFIKL01ldGFkYXRhIDE1IDAgUgo+PgplbmRvYmoKMTQgMCBvYmoKPDwvRmlsdGVyL0Zs"
    "YXRlRGVjb2RlL0xlbmd0aCAyMTE+PnN0cmVhbQqA3RqfWUcDMLN632RwKXfHQwo9UhcVLMApbq7eFmR1kCKC4L4C"
    "ju7uRuZW5eKMiOVSIL06H3g37tPWb0VTCto8UakmWXZAQTcNXDufklDP9xokhKc6801b/BSAMZVoDfdDYmw9oUJl"
    "4489z/RE8Z6IVXOVBoYlVivHtCbTJaDgghufq7LxdMiQSqhyKFT7o5MGYjGYerHMqOQ40dD/JlVY7iT+IX7aDK0W"
    "p5VXK0z/lc4W/inlLXqVMAaWvDmWrGs9TNT54Gfteu2stXZYGy/pM+9jCmVuZHN0cmVhbQplbmRvYmoKMTUgMCBv"
    "YmoKPDwvVHlwZS9NZXRhZGF0YQovU3VidHlwZS9YTUwvTGVuZ3RoIDE0NTM+PnN0cmVhbQo8P3hwYWNrZXQgYmVn"
    "aW49J++7vycgaWQ9J1c1TTBNcENlaGlIenJlU3pOVGN6a2M5ZCc/Pgo8P2Fkb2JlLXhhcC1maWx0ZXJzIGVzYz0i"
    "Q1JMRiI/Pgo8eDp4bXBtZXRhIHhtbG5zOng9J2Fkb2JlOm5zOm1ldGEvJyB4OnhtcHRrPSdYTVAgdG9vbGtpdCAy"
    "LjkuMS0xMywgZnJhbWV3b3JrIDEuNic+CjxyZGY6UkRGIHhtbG5zOnJkZj0naHR0cDovL3d3dy53My5vcmcvMTk5"
    "OS8wMi8yMi1yZGYtc3ludGF4LW5zIycgeG1sbnM6aVg9J2h0dHA6Ly9ucy5hZG9iZS5jb20vaVgvMS4wLyc+Cjxy"
    "ZGY6RGVzY3JpcHRpb24gcmRmOmFib3V0PSIiIHhtbG5zOnBkZj0naHR0cDovL25zLmFkb2JlLmNvbS9wZGYvMS4z"
    "LycgcGRmOlByb2R1Y2VyPSdHUEwgR2hvc3RzY3JpcHQgMTAuMDYuMCcvPgo8cmRmOkRlc2NyaXB0aW9uIHJkZjph"
    "Ym91dD0iIiB4bWxuczp4bXA9J2h0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC8nPjx4bXA6TW9kaWZ5RGF0ZT4y"
    "MDI2LTExLTAzVDIwOjM4OjIxKzAxOjAwPC94bXA6TW9kaWZ5RGF0ZT4KPHhtcDpDcmVhdGVEYXRlPjIwMjYtMTEt"
    "MDNUMjA6Mzg6MjErMDE6MDA8L3htcDpDcmVhdGVEYXRlPgo8eG1wOk1ldGFkYXRhRGF0ZT4yMDI2LTExLTAzVDIw"
    "OjM4OjIxKzAxOjAwPC94bXA6TWV0YWRhdGFEYXRlPgo8eG1wOkNyZWF0b3JUb29sPlVua25vd25BcHBsaWNhdGlv"
    "bjwveG1wOkNyZWF0b3JUb29sPjwvcmRmOkRlc2NyaXB0aW9uPgo8cmRmOkRlc2NyaXB0aW9uIHJkZjphYm91dD0i"
    "IiB4bWxuczp4bXBNTT0naHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL21tLycgeG1wTU06RG9jdW1lbnRJRD0n"
    "dXVpZDphZDI1YTg0My0wZmRhLTExZmQtMDAwMC00MTI0ZGYzZTJmODknLz4KPHJkZjpEZXNjcmlwdGlvbiByZGY6"
    "YWJvdXQ9IiIgeG1sbnM6eG1wTU09J2h0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9tbS8nIHhtcE1NOlJlbmRp"
    "dGlvbkNsYXNzPSdkZWZhdWx0Jy8+CjxyZGY6RGVzY3JpcHRpb24gcmRmOmFib3V0PSIiIHhtbG5zOnhtcE1NPSdo"
    "dHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvbW0vJyB4bXBNTTpWZXJzaW9uSUQ9JzEnLz4KPHJkZjpEZXNjcmlw"
    "dGlvbiByZGY6YWJvdXQ9IiIgeG1sbnM6ZGM9J2h0dHA6Ly9wdXJsLm9yZy9kYy9lbGVtZW50cy8xLjEvJyBkYzpm"
    "b3JtYXQ9J2FwcGxpY2F0aW9uL3BkZic+PGRjOnRpdGxlPjxyZGY6QWx0PjxyZGY6bGkgeG1sOmxhbmc9J3gtZGVm"
    "YXVsdCc+VW50aXRsZWQ8L3JkZjpsaT48L3JkZjpBbHQ+PC9kYzp0aXRsZT48L3JkZjpEZXNjcmlwdGlvbj4KPC9y"
    "ZGY6UkRGPgo8L3g6eG1wbWV0YT4KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg"
    "ICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg"
    "ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAo8P3hwYWNrZXQgZW5kPSd3Jz8+CmVuZHN0cmVhbQpl"
    "bmRvYmoKOCAwIG9iago8PC9GaWx0ZXIvRmxhdGVEZWNvZGUKL1R5cGUvT2JqU3RtCi9OIDYKL0ZpcnN0IDMxL0xl"
    "bmd0aCAxOTI+PnN0cmVhbQpqfziAbdieHN58R4WKSGtX8hHZClBFGbuy9lwGSUYj3sXlVzOue2qQlcufFyi7Uk7R"
    "aGA8l/pUlFCIsaiTOHDnS2sk9QSLWVLod9SbJgz2m1GsVjhyMnK6MRsLpk9QLRFbZSVOxMJYSAAgXqSr+YZtXQJh"
    "xZLhXzLQaG6L0WulNnRCHCNVuQm+pPoihcNXT1xK5RPgXnEzc6M9Z52DsYqLOj2TBSLw1DyS84UpeO7E8rDWKcL9"
    "IHiww8sN+Rs6ZtAKZW5kc3RyZWFtCmVuZG9iagoxNiAwIG9iago8PC9GaWx0ZXIgL1N0YW5kYXJkIC9WIDEgL0xl"
    "bmd0aCA0MCAvUiAyIC9QIC00IC9PIChZrrwLIo0Cod0a/XvlKtJJr9xv1x75I0pJv6VutyyAGikKL1UgKL0g6OV0"
    "PtAutbUY5G5qS+uwTFxcFjGdQsZLFxAZaCKBJCk+PgplbmRvYmoKMTcgMCBvYmoKPDwKL1R5cGUgL1hSZWYKL1Np"
    "emUgMTgKL1Jvb3QgMSAwIFIgL0luZm8gMiAwIFIKL0lEIFs8QjcyMzhCOEFFM0U5MTAwRDU0QTVCMjVBQzA5NzU0"
    "RkU+PEI3MjM4QjhBRTNFOTEwMEQ1NEE1QjI1QUMwOTc1NEZFPl0KL0VuY3J5cHQgMTYgMCBSIC9JbmRleCBbMCAx"
    "OCBdCi9XIFsxIDIgMl0KL0ZpbHRlciAvRmxhdGVEZWNvZGUvTGVuZ3RoIDcyCj4+CnN0cmVhbQp4nCXKsQ2AQAxD"
    "0e8kSAiYhh1YgYoJ6G8kFmGxI0eaJ9sy0Ls8wJiZZC9IT8Jd209oOStJto+LVbWBy4/c4krWlmwOH2VcBf4KZW5k"
    "c3RyZWFtCmVuZG9iagpzdGFydHhyZWYKMzA3NQolJUVPRgo="
)

IMPORT = """
async ({ base64, name }) => {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let at = 0; at < binary.length; at++) bytes[at] = binary.charCodeAt(at)
  const importing = window.nibApp.importing
  importing.root = window.nibApp.workspace.activeSpace.root
  await importing.take([new File([bytes], name, { type: 'application/pdf' })])
  await importing.run()
  await window.nibApp.workspace.loadTree()
  const stem = name.replace('.pdf', '')
  const path = window.nibApp.workspace.files.find((one) => one.name === stem + '.pages').path
  await window.nibApp.workspace.openEntry(path)
}
"""

DARK = """
async (src) => {
  const image = new Image()
  image.src = src
  await image.decode()
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const ctx = canvas.getContext('2d')
  ctx.drawImage(image, 0, 0)
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  let dark = 0
  for (let at = 0; at < data.length; at += 4) {
    if (data[at] < 80 && data[at + 1] < 80 && data[at + 2] < 80) dark += 1
  }
  return dark
}
"""


def exported(page: Page, row: str) -> bytes:
    page.keyboard.press("Control+Shift+P")
    page.wait_for_selector(".palette input")
    page.keyboard.type(row, delay=1)
    page.wait_for_function(
        "(row) => [...document.querySelectorAll('[role=option]')].some((one) => one.innerText.startsWith(row))",
        arg=row,
    )
    with page.expect_download(timeout=30000) as asked:
        page.keyboard.press("Enter")
    return asked.value.path().read_bytes()


def opened_with_ink(page: Page, name: str, paper: str) -> None:
    page.evaluate(IMPORT, {"base64": paper, "name": name})
    page.wait_for_selector(".pages", timeout=15000)
    wait_for(page, "document.querySelectorAll('.pages canvas').length > 0", "the sheets")
    page.wait_for_timeout(1000)
    box = page.locator(".pages").first.bounding_box()
    page.keyboard.press("d")
    x, y = box["x"] + box["width"] / 2, box["y"] + 150
    page.mouse.move(x - 50, y)
    page.mouse.down()
    page.mouse.move(x + 50, y + 50, steps=10)
    page.mouse.up()
    page.keyboard.press("v")
    page.wait_for_timeout(300)


def looked_at(page: Page, name: str, mime: str, body: bytes) -> int:
    src = f"data:{mime};base64,{base64.b64encode(body).decode()}"
    dark = page.evaluate(DARK, src)
    say(f"{name}: {dark} dark pixels")
    return dark


def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 860})
    DRIVE.open(page)
    wait_for(page, "!!window.nibApp.importing", "the import store")

    opened_with_ink(page, "Real.pdf", PLAIN)
    for row, kind, mime in (
        ("Export as PNG", ".png", "image/png"),
        ("Export as SVG", ".svg", "image/svg+xml"),
    ):
        pictures = zipfile.ZipFile(io.BytesIO(exported(page, row)))
        names = sorted(one for one in pictures.namelist() if one.endswith(kind))
        if len(names) != 2:
            wrong(f"{row}: {names}, not two sheets")
        for name in names:
            if looked_at(page, name, mime, pictures.read(name)) < 500:
                wrong(f"{row}: {name} is a white sheet, the paper's page is not on it")

    opened_with_ink(page, "Locked.pdf", LOCKED)
    word = "document.querySelector('.track.failed .said')?.innerText === 'This PDF is locked by its owner'"
    page.keyboard.press("Control+Shift+P")
    page.wait_for_selector(".palette input")
    page.keyboard.type("Export as PDF", delay=1)
    page.wait_for_function(
        "() => [...document.querySelectorAll('[role=option]')].some((one) => one.innerText.startsWith('Export as PDF'))"
    )
    page.keyboard.press("Enter")
    wait_for(page, word, "the word on Export as PDF")
    shot(page, "01-locked-said")

    pictures = zipfile.ZipFile(io.BytesIO(exported(page, "Export as PNG")))
    wait_for(page, word, "the word on Export as PNG")
    for name in sorted(one for one in pictures.namelist() if one.endswith(".png")):
        if looked_at(page, name, "image/png", pictures.read(name)) > 5000:
            wrong(f"the locked paper's page came out in {name}")


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive))
