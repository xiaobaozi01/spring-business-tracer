package com.acme.worker.messaging;

import org.springframework.jms.annotation.JmsListener;
import org.springframework.stereotype.Component;

@Component
public class DynamicBillingListener {
    @JmsListener(destination = "#{runtimeDestinationProvider.destination()}")
    public void consumeDynamic(String body) { }
}
