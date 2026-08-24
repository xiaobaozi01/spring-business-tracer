package com.acme.gateway.client;

import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;

@Component
public class CatalogWebClient {
    private final WebClient client = WebClient.builder().baseUrl("http://catalog-service").build();
    public void fetch(String sku) {
        client.get().uri("/api/catalog/{sku}", sku).retrieve().bodyToMono(String.class);
    }
}
