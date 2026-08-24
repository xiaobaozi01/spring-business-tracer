package com.acme.order.mapper;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface AuditMapper {
    void insertAudit(@Param("bizNo") String bizNo);
}
