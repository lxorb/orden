#!/usr/bin/env python3

import json
import sys
import time

from gi.repository import Gio, GLib

DESKTOP = "org.freedesktop.portal.Desktop"
PATH = "/org/freedesktop/portal/desktop"

INTERFACES = Gio.DBusNodeInfo.new_for_xml(
    """
<node>
  <interface name="org.freedesktop.portal.GlobalShortcuts">
    <method name="CreateSession">
      <arg type="a{sv}" name="options" direction="in"/>
      <arg type="o" name="handle" direction="out"/>
    </method>
    <method name="BindShortcuts">
      <arg type="o" name="session_handle" direction="in"/>
      <arg type="a(sa{sv})" name="shortcuts" direction="in"/>
      <arg type="s" name="parent_window" direction="in"/>
      <arg type="a{sv}" name="options" direction="in"/>
      <arg type="o" name="request_handle" direction="out"/>
    </method>
    <method name="ListShortcuts">
      <arg type="o" name="session_handle" direction="in"/>
      <arg type="a{sv}" name="options" direction="in"/>
      <arg type="o" name="request_handle" direction="out"/>
    </method>
    <method name="ConfigureShortcuts">
      <arg type="o" name="session_handle" direction="in"/>
      <arg type="s" name="parent_window" direction="in"/>
      <arg type="a{sv}" name="options" direction="in"/>
    </method>
    <signal name="Activated">
      <arg type="o" name="session_handle"/>
      <arg type="s" name="shortcut_id"/>
      <arg type="t" name="timestamp"/>
      <arg type="a{sv}" name="options"/>
    </signal>
    <property name="version" type="u" access="read"/>
  </interface>
  <interface name="org.freedesktop.host.portal.Registry">
    <method name="Register">
      <arg type="s" name="app_id" direction="in"/>
      <arg type="a{sv}" name="options" direction="in"/>
    </method>
  </interface>
  <interface name="org.freedesktop.portal.Session">
    <method name="Close"/>
  </interface>
</node>
"""
)

log_file = open(sys.argv[1], "a", buffering=1)
sessions = {}

def said(**what):
    log_file.write(json.dumps(what) + "\n")

def sender_part(sender):
    return sender.lstrip(":").replace(".", "_")

def respond(bus, path, results):

    def send():
        bus.emit_signal(
            None,
            path,
            "org.freedesktop.portal.Request",
            "Response",
            GLib.Variant("(ua{sv})", (0, results)),
        )
        return False

    GLib.timeout_add(50, send)

def press(bus, session, shortcut):
    def send():
        said(call="Activated", session=session, shortcut=shortcut)
        bus.emit_signal(
            None,
            PATH,
            "org.freedesktop.portal.GlobalShortcuts",
            "Activated",
            GLib.Variant(
                "(osta{sv})",
                (
                    session,
                    shortcut,
                    int(time.monotonic() * 1000),
                    {"activation_token": GLib.Variant("s", "ci-token")},
                ),
            ),
        )
        return False

    GLib.timeout_add(2000, send)

def session_call(bus, sender, path, interface, method, variant, invocation):
    said(call=method, session=path)
    sessions.pop(path, None)
    invocation.return_value(None)

def call(bus, sender, path, interface, method, variant, invocation):
    who = sender_part(sender)
    params = variant.unpack()
    if method == "Register":
        said(call=method, app_id=params[0])
        invocation.return_value(None)
    elif method == "CreateSession":
        options = params[0]
        request = f"{PATH}/request/{who}/{options['handle_token']}"
        session = f"{PATH}/session/{who}/{options['session_handle_token']}"
        sessions[session] = []
        bus.register_object(session, INTERFACES.interfaces[2], session_call, None, None)
        said(call=method, session=session)
        invocation.return_value(GLib.Variant("(o)", (request,)))
        respond(bus, request, {"session_handle": GLib.Variant("s", session)})
    elif method == "BindShortcuts":
        session, shortcuts, _parent, options = params
        request = f"{PATH}/request/{who}/{options['handle_token']}"
        bound = [
            (
                shortcut,
                {
                    "description": GLib.Variant("s", details.get("description", "")),
                    "trigger_description": GLib.Variant(
                        "s", details.get("preferred_trigger", "")
                    ),
                },
            )
            for shortcut, details in shortcuts
        ]
        sessions[session] = [shortcut for shortcut, _ in shortcuts]
        said(call=method, session=session, shortcuts=[[s, d] for s, d in shortcuts])
        invocation.return_value(GLib.Variant("(o)", (request,)))
        respond(bus, request, {"shortcuts": GLib.Variant("a(sa{sv})", bound)})
        if bound:
            press(bus, session, bound[0][0])
    elif method == "ListShortcuts":
        session, options = params
        request = f"{PATH}/request/{who}/{options['handle_token']}"
        invocation.return_value(GLib.Variant("(o)", (request,)))
        respond(bus, request, {"shortcuts": GLib.Variant("a(sa{sv})", [])})
    elif method == "ConfigureShortcuts":
        said(call=method, session=params[0])
        invocation.return_value(None)

def property_of(bus, sender, path, interface, name):
    return GLib.Variant("u", 2)

def acquired(bus, name):
    bus.register_object(PATH, INTERFACES.interfaces[0], call, property_of, None)
    bus.register_object(PATH, INTERFACES.interfaces[1], call, None, None)

def owned(bus, name):
    said(call="owned", name=name)

Gio.bus_own_name(
    Gio.BusType.SESSION, DESKTOP, Gio.BusNameOwnerFlags.NONE, acquired, owned, None
)
GLib.MainLoop().run()
